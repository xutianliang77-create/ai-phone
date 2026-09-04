import { createHash } from "node:crypto";

export type Gate0BMarkerKind = "mic" | "tts";

export interface Gate0BMarkerManifest {
  version: 1;
  sampleRateHz: 8_000 | 16_000;
  analysisWindowMs: number;
  markerDurationMs: number;
  amplitudePcm16: number;
  micFrequencyHz: number;
  ttsFrequencyHz: number;
  detectionCorrelationThreshold: number;
  maxUndetectedGapMs: number;
}

export interface Gate0BMarkerSummary {
  marker: Gate0BMarkerKind;
  markerManifestSha256: string;
  sampleRateHz: number;
  analysedSamples: number;
  analysedWindows: number;
  detectedWindows: number;
  peakCorrelation: number;
  maxUndetectedGapMs: number;
}

export interface Gate0BIsolationWindow {
  name: string;
  tts: Gate0BMarkerSummary;
  mic: Gate0BMarkerSummary;
}

export type Gate0BIsolationDecision =
  | "pass_candidate"
  | "fail_tts_absent"
  | "fail_tts_gap"
  | "fail_mic_leak";

export interface Gate0BIsolationAssessment {
  decision: Gate0BIsolationDecision;
  failedWindows: string[];
  markerManifestSha256: string;
}

/**
 * Validates an explicit, pre-frozen marker configuration. The caller must
 * retain only this manifest digest and the returned summaries; PCM stays in
 * process memory and is intentionally never written by this module.
 */
export function createGate0BMarkerManifest(
  input: Gate0BMarkerManifest,
): Gate0BMarkerManifest {
  const manifest = { ...input };
  if (manifest.version !== 1) {
    throw new Error("Gate 0B marker manifest version must be 1");
  }
  if (manifest.sampleRateHz !== 8_000 && manifest.sampleRateHz !== 16_000) {
    throw new Error("Gate 0B marker sampleRateHz must be 8000 or 16000");
  }
  assertPositiveInteger(manifest.analysisWindowMs, "analysisWindowMs");
  assertPositiveInteger(manifest.markerDurationMs, "markerDurationMs");
  assertPositiveInteger(manifest.amplitudePcm16, "amplitudePcm16");
  if (manifest.amplitudePcm16 > 32_767) {
    throw new Error("amplitudePcm16 must not exceed PCM16 range");
  }
  assertPositiveInteger(manifest.micFrequencyHz, "micFrequencyHz");
  assertPositiveInteger(manifest.ttsFrequencyHz, "ttsFrequencyHz");
  if (manifest.micFrequencyHz === manifest.ttsFrequencyHz) {
    throw new Error("MIC and TTS markers must use distinct frequencies");
  }
  const nyquistHz = manifest.sampleRateHz / 2;
  for (const frequencyHz of [manifest.micFrequencyHz, manifest.ttsFrequencyHz]) {
    if (frequencyHz >= nyquistHz) {
      throw new Error("Marker frequency must be below Nyquist");
    }
    assertCompleteWindowCycles(manifest, frequencyHz);
  }
  if (!Number.isFinite(manifest.detectionCorrelationThreshold) ||
    manifest.detectionCorrelationThreshold <= 0 ||
    manifest.detectionCorrelationThreshold > 1) {
    throw new Error("detectionCorrelationThreshold must be in (0, 1]");
  }
  assertPositiveInteger(manifest.maxUndetectedGapMs, "maxUndetectedGapMs");
  if (manifest.maxUndetectedGapMs % manifest.analysisWindowMs !== 0) {
    throw new Error("maxUndetectedGapMs must be a whole analysis window");
  }
  return Object.freeze(manifest);
}

export function gate0BMarkerManifestSha256(manifest: Gate0BMarkerManifest) {
  const valid = createGate0BMarkerManifest(manifest);
  return createHash("sha256").update(markerManifestCanonicalJson(valid)).digest("hex");
}

/**
 * Creates an in-memory PCM16 marker for an external MIC speaker or the
 * approved VUART injection endpoint. It has no file, serial, or network I/O.
 */
export function generateGate0BMarkerPcm(
  manifest: Gate0BMarkerManifest,
  marker: Gate0BMarkerKind,
  durationMs = manifest.markerDurationMs,
) {
  const valid = createGate0BMarkerManifest(manifest);
  assertPositiveInteger(durationMs, "durationMs");
  if (durationMs % valid.analysisWindowMs !== 0) {
    throw new Error("durationMs must contain whole analysis windows");
  }
  const sampleCount = valid.sampleRateHz * durationMs / 1_000;
  if (!Number.isInteger(sampleCount)) {
    throw new Error("durationMs must align to whole PCM samples");
  }
  const frequencyHz = markerFrequency(valid, marker);
  return Int16Array.from({ length: sampleCount }, (_, sampleIndex) => Math.round(
    valid.amplitudePcm16 * Math.sin(
      2 * Math.PI * frequencyHz * sampleIndex / valid.sampleRateHz,
    ),
  ));
}

/**
 * Reduces PCM held by the caller to marker-only metrics. The returned value
 * intentionally contains neither PCM nor reconstructed speech content.
 */
export function summarizeGate0BMarker(
  manifest: Gate0BMarkerManifest,
  marker: Gate0BMarkerKind,
  pcm: Int16Array,
): Gate0BMarkerSummary {
  const valid = createGate0BMarkerManifest(manifest);
  if (!(pcm instanceof Int16Array) || pcm.length === 0) {
    throw new Error("Gate 0B marker PCM must be a non-empty Int16Array");
  }
  const windowSamples = valid.sampleRateHz * valid.analysisWindowMs / 1_000;
  if (pcm.length % windowSamples !== 0) {
    throw new Error("Gate 0B marker PCM must contain whole analysis windows");
  }

  const frequencyHz = markerFrequency(valid, marker);
  const correlations: number[] = [];
  for (let offset = 0; offset < pcm.length; offset += windowSamples) {
    correlations.push(normalizedFrequencyCorrelation(
      pcm,
      offset,
      windowSamples,
      valid.sampleRateHz,
      frequencyHz,
    ));
  }
  const detected = correlations.map((correlation) =>
    correlation >= valid.detectionCorrelationThreshold,
  );
  return {
    marker,
    markerManifestSha256: gate0BMarkerManifestSha256(valid),
    sampleRateHz: valid.sampleRateHz,
    analysedSamples: pcm.length,
    analysedWindows: correlations.length,
    detectedWindows: detected.filter(Boolean).length,
    peakCorrelation: Math.max(...correlations),
    maxUndetectedGapMs: maxUndetectedGapMs(
      detected,
      valid.analysisWindowMs,
    ),
  };
}

/**
 * Evaluates one or more predeclared test windows. A pass remains only a
 * candidate: it says the summaries meet frozen thresholds, not that carrier
 * routing or physical microphone isolation has independently been proven.
 */
export function assessGate0BIsolation(
  manifest: Gate0BMarkerManifest,
  windows: readonly Gate0BIsolationWindow[],
): Gate0BIsolationAssessment {
  const valid = createGate0BMarkerManifest(manifest);
  if (windows.length === 0) {
    throw new Error("Gate 0B isolation assessment requires at least one window");
  }
  const digest = gate0BMarkerManifestSha256(valid);
  const ttsAbsent: string[] = [];
  const ttsGap: string[] = [];
  const micLeak: string[] = [];
  for (const window of windows) {
    if (!window.name.trim()) throw new Error("Gate 0B window name is required");
    assertSummary(window.tts, "tts", digest, valid.sampleRateHz);
    assertSummary(window.mic, "mic", digest, valid.sampleRateHz);
    if (window.tts.detectedWindows === 0) ttsAbsent.push(window.name);
    else if (window.tts.maxUndetectedGapMs > valid.maxUndetectedGapMs) {
      ttsGap.push(window.name);
    }
    if (window.mic.detectedWindows > 0) micLeak.push(window.name);
  }
  if (ttsAbsent.length > 0) {
    return { decision: "fail_tts_absent", failedWindows: ttsAbsent, markerManifestSha256: digest };
  }
  if (ttsGap.length > 0) {
    return { decision: "fail_tts_gap", failedWindows: ttsGap, markerManifestSha256: digest };
  }
  if (micLeak.length > 0) {
    return { decision: "fail_mic_leak", failedWindows: micLeak, markerManifestSha256: digest };
  }
  return { decision: "pass_candidate", failedWindows: [], markerManifestSha256: digest };
}

function markerFrequency(manifest: Gate0BMarkerManifest, marker: Gate0BMarkerKind) {
  return marker === "mic" ? manifest.micFrequencyHz : manifest.ttsFrequencyHz;
}

function markerManifestCanonicalJson(manifest: Gate0BMarkerManifest) {
  return JSON.stringify({
    version: manifest.version,
    sampleRateHz: manifest.sampleRateHz,
    analysisWindowMs: manifest.analysisWindowMs,
    markerDurationMs: manifest.markerDurationMs,
    amplitudePcm16: manifest.amplitudePcm16,
    micFrequencyHz: manifest.micFrequencyHz,
    ttsFrequencyHz: manifest.ttsFrequencyHz,
    detectionCorrelationThreshold: manifest.detectionCorrelationThreshold,
    maxUndetectedGapMs: manifest.maxUndetectedGapMs,
  });
}

function normalizedFrequencyCorrelation(
  pcm: Int16Array,
  offset: number,
  sampleCount: number,
  sampleRateHz: number,
  frequencyHz: number,
) {
  let cosine = 0;
  let sine = 0;
  let energy = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = pcm[offset + index];
    const phase = 2 * Math.PI * frequencyHz * index / sampleRateHz;
    cosine += sample * Math.cos(phase);
    sine += sample * Math.sin(phase);
    energy += sample * sample;
  }
  if (energy === 0) return 0;
  return Math.sqrt(cosine * cosine + sine * sine) /
    Math.sqrt(energy * sampleCount / 2);
}

function maxUndetectedGapMs(detected: readonly boolean[], windowMs: number) {
  let consecutive = 0;
  let largest = 0;
  for (const present of detected) {
    if (present) consecutive = 0;
    else consecutive += 1;
    largest = Math.max(largest, consecutive);
  }
  return largest * windowMs;
}

function assertSummary(
  summary: Gate0BMarkerSummary,
  marker: Gate0BMarkerKind,
  digest: string,
  sampleRateHz: number,
) {
  if (summary.marker !== marker || summary.markerManifestSha256 !== digest ||
    summary.sampleRateHz !== sampleRateHz || summary.analysedWindows <= 0 ||
    summary.detectedWindows < 0 ||
    summary.detectedWindows > summary.analysedWindows) {
    throw new Error("Gate 0B marker summary does not match the frozen manifest");
  }
}

function assertCompleteWindowCycles(
  manifest: Gate0BMarkerManifest,
  frequencyHz: number,
) {
  const cycles = frequencyHz * manifest.analysisWindowMs / 1_000;
  if (!Number.isInteger(cycles)) {
    throw new Error("Marker frequency must contain whole cycles per analysis window");
  }
}

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
