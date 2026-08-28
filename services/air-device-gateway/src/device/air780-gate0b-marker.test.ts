import { describe, expect, it } from "vitest";
import {
  assessGate0BIsolation,
  createGate0BMarkerManifest,
  gate0BMarkerManifestSha256,
  generateGate0BMarkerPcm,
  summarizeGate0BMarker,
} from "./air780-gate0b-marker.js";

const manifest = createGate0BMarkerManifest({
  version: 1,
  sampleRateHz: 16_000,
  analysisWindowMs: 20,
  markerDurationMs: 200,
  amplitudePcm16: 8_000,
  micFrequencyHz: 1_000,
  ttsFrequencyHz: 1_600,
  detectionCorrelationThreshold: 0.25,
  maxUndetectedGapMs: 40,
});

describe("Air780 Gate 0B dual-marker evidence helper", () => {
  it("creates deterministic in-memory PCM and exposes only a frozen manifest digest", () => {
    const first = generateGate0BMarkerPcm(manifest, "tts");
    const second = generateGate0BMarkerPcm(manifest, "tts");

    expect(first).toEqual(second);
    expect(first).toHaveLength(3_200);
    expect(Math.max(...first)).toBeLessThanOrEqual(manifest.amplitudePcm16);
    expect(Math.min(...first)).toBeGreaterThanOrEqual(-manifest.amplitudePcm16);

    const summary = summarizeGate0BMarker(manifest, "tts", first);
    expect(summary).toEqual({
      marker: "tts",
      markerManifestSha256: gate0BMarkerManifestSha256(manifest),
      sampleRateHz: 16_000,
      analysedSamples: 3_200,
      analysedWindows: 10,
      detectedWindows: 10,
      peakCorrelation: expect.closeTo(1, 6),
      maxUndetectedGapMs: 0,
    });
    expect(summary).not.toHaveProperty("pcm");

    const reordered = createGate0BMarkerManifest({
      maxUndetectedGapMs: 40,
      detectionCorrelationThreshold: 0.25,
      ttsFrequencyHz: 1_600,
      micFrequencyHz: 1_000,
      amplitudePcm16: 8_000,
      markerDurationMs: 200,
      analysisWindowMs: 20,
      sampleRateHz: 16_000,
      version: 1,
    });
    expect(gate0BMarkerManifestSha256(reordered))
      .toBe(gate0BMarkerManifestSha256(manifest));
  });

  it("distinguishes orthogonal MIC and TTS markers without assuming phase alignment", () => {
    const tts = generateGate0BMarkerPcm(manifest, "tts");
    const mic = generateGate0BMarkerPcm(manifest, "mic");
    const ttsSummary = summarizeGate0BMarker(manifest, "tts", tts);
    const micInTts = summarizeGate0BMarker(manifest, "mic", tts);
    const micSummary = summarizeGate0BMarker(manifest, "mic", mic);

    expect(ttsSummary.detectedWindows).toBe(10);
    expect(ttsSummary.peakCorrelation).toBeCloseTo(1, 6);
    expect(micInTts.detectedWindows).toBe(0);
    expect(micInTts.peakCorrelation).toBeLessThan(0.01);
    expect(micSummary.detectedWindows).toBe(10);
  });

  it("fails a candidate when TTS is absent, gap exceeds threshold, or MIC leaks", () => {
    const tts = generateGate0BMarkerPcm(manifest, "tts");
    const mic = generateGate0BMarkerPcm(manifest, "mic");
    const silence = new Int16Array(tts.length);
    const ttsSummary = summarizeGate0BMarker(manifest, "tts", tts);
    const noMic = summarizeGate0BMarker(manifest, "mic", tts);
    const noTts = summarizeGate0BMarker(manifest, "tts", silence);
    const micLeak = summarizeGate0BMarker(manifest, "mic", mic);
    const gap = Int16Array.from(tts);
    gap.fill(0, 4 * 320, 7 * 320);
    const ttsGap = summarizeGate0BMarker(manifest, "tts", gap);

    expect(assessGate0BIsolation(manifest, [{
      name: "pre-first-tts",
      tts: noTts,
      mic: noMic,
    }])).toMatchObject({
      decision: "fail_tts_absent",
      failedWindows: ["pre-first-tts"],
    });
    expect(assessGate0BIsolation(manifest, [{
      name: "underrun",
      tts: ttsGap,
      mic: noMic,
    }])).toMatchObject({
      decision: "fail_tts_gap",
      failedWindows: ["underrun"],
    });
    expect(assessGate0BIsolation(manifest, [{
      name: "ext-src-done",
      tts: ttsSummary,
      mic: micLeak,
    }])).toMatchObject({
      decision: "fail_mic_leak",
      failedWindows: ["ext-src-done"],
    });
  });

  it("requires frozen formats, orthogonal frequencies, and complete windows", () => {
    expect(() => createGate0BMarkerManifest({
      ...manifest,
      micFrequencyHz: manifest.ttsFrequencyHz,
    })).toThrow("distinct frequencies");
    expect(() => createGate0BMarkerManifest({
      ...manifest,
      ttsFrequencyHz: 1_555,
    })).toThrow("whole cycles");
    expect(() => summarizeGate0BMarker(
      manifest,
      "tts",
      new Int16Array(321),
    )).toThrow("whole analysis windows");
    expect(() => generateGate0BMarkerPcm(manifest, "tts", 30))
      .toThrow("whole analysis windows");
  });
});
