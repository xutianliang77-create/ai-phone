import crypto from "node:crypto";
import fs from "node:fs";

export function parsePcm16Wav(buffer) {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("audio must be a RIFF WAVE file");
  }
  let format;
  let pcm;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) throw new Error("WAV chunk exceeds file size");
    if (kind === "fmt " && size >= 16) {
      format = {
        encoding: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    }
    if (kind === "data") pcm = buffer.subarray(start, end);
    offset = end + (size % 2);
  }
  if (
    !format ||
    format.encoding !== 1 ||
    format.channels !== 1 ||
    format.bitsPerSample !== 16 ||
    !pcm ||
    pcm.length % 2 !== 0
  ) {
    throw new Error("audio must be mono PCM16 WAV");
  }
  return {
    sampleRate: format.sampleRate,
    pcm,
    durationMs: Math.round(pcm.length / 2 / format.sampleRate * 1000),
  };
}

export function encodePcm16Wav(pcm, sampleRate) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 !== 0) {
    throw new Error("PCM16 evidence must contain complete samples");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function pcmForIntervals(wav, intervals) {
  return Buffer.concat(intervals.map((interval) => {
    const start = sampleAt(wav, interval.startMs);
    const end = sampleAt(wav, interval.endMs);
    return wav.pcm.subarray(start * 2, end * 2);
  }));
}

export function mergeSpeakerSpans(index, spans, observedAudioMs) {
  for (const span of spans) {
    if (!validSpan(span)) continue;
    const key = `${span.speakerId}:${span.startMs}`;
    const previous = index.get(key);
    index.set(key, {
      ...span,
      firstObservedAudioMs:
        previous?.firstObservedAudioMs ?? observedAudioMs,
    });
  }
}

export function buildAliasSegments(
  caseId,
  spans,
  segmentMs,
  diagnosticOnly,
) {
  const chunks = [];
  for (const span of spans.filter(validSpan)) {
    for (let startMs = span.startMs; startMs < span.endMs;) {
      const endMs = Math.min(span.endMs, startMs + segmentMs);
      chunks.push({
        rawSpeakerId: span.speakerId,
        startMs,
        endMs,
        overlap: diagnosticOnly || span.overlap === true,
      });
      startMs = endMs;
    }
  }
  return chunks
    .sort((left, right) =>
      left.startMs - right.startMs ||
      left.endMs - right.endMs ||
      left.rawSpeakerId.localeCompare(right.rawSpeakerId)
    )
    .map((chunk, index) => ({
      ...chunk,
      segmentId: `${caseId}:speaker:${index + 1}`,
      turnId: `${caseId}:turn:${index + 1}`,
      revision: 0,
      canonicalSpeakerId: chunk.rawSpeakerId,
    }));
}

export function buildAliasInputSegments({
  caseId,
  spans,
  durationMs,
  segmentMs,
  minimumEvidenceMs,
  diagnosticOnly,
  inputMode,
}) {
  if (inputMode !== "controlled-slot-switch" || diagnosticOnly) {
    return buildAliasSegments(caseId, spans, segmentMs, diagnosticOnly);
  }
  const splitMs = Math.round(durationMs / 2);
  const replaySpans = durationMs < minimumEvidenceMs * 2
    ? [{
        speakerId: "replay_speaker_1",
        startMs: 0,
        endMs: durationMs,
        overlap: false,
      }]
    : [
        {
          speakerId: "replay_speaker_1",
          startMs: 0,
          endMs: splitMs,
          overlap: false,
        },
        {
          speakerId: "replay_speaker_2",
          startMs: splitMs,
          endMs: durationMs,
          overlap: false,
        },
      ];
  return buildAliasSegments(caseId, replaySpans, segmentMs, false);
}

export function applySpeakerUpdates(segments, updates) {
  const byId = new Map(segments.map((segment) => [segment.segmentId, segment]));
  for (const update of updates) {
    const segment = byId.get(update.segmentId);
    if (!segment || !update.speaker?.speakerId) continue;
    segment.canonicalSpeakerId = update.speaker.speakerId;
    segment.revision = update.revision ?? segment.revision + 1;
  }
}

export function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return round(sorted[lower] * (1 - weight) + sorted[upper] * weight, 3);
}

export function readJsonl(path) {
  return fs.readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function writeJsonl(path, rows) {
  fs.writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

export async function createSpeakerSession({
  baseUrl,
  apiKey,
  sessionId,
  fetchFn = fetch,
}) {
  await requestJson({
    baseUrl,
    apiKey,
    path: "/speaker/sessions",
    body: {
      sessionId,
      options: {
        mode: "diarization",
        maxSpeakers: 4,
        allowVoiceIdentity: false,
      },
    },
    fetchFn,
    expectJson: false,
  });
}

export async function closeSpeakerSession({
  baseUrl,
  apiKey,
  sessionId,
  fetchFn = fetch,
}) {
  await requestJson({
    baseUrl,
    apiKey,
    path: `/speaker/sessions/${encodeURIComponent(sessionId)}`,
    method: "DELETE",
    fetchFn,
    expectJson: false,
  });
}

export async function streamSpeakerAudio({
  baseUrl,
  apiKey,
  sessionId,
  wav,
  frameMs,
  fetchFn = fetch,
}) {
  const spans = new Map();
  const frameSamples = Math.max(
    1,
    Math.round(wav.sampleRate * frameMs / 1000),
  );
  let sequence = 0;
  let firstEvidenceAudioMs = null;
  for (let startSample = 0; startSample < wav.pcm.length / 2;) {
    const endSample = Math.min(
      wav.pcm.length / 2,
      startSample + frameSamples,
    );
    sequence += 1;
    const observedAudioMs = Math.round(endSample / wav.sampleRate * 1000);
    const response = await requestJson({
      baseUrl,
      apiKey,
      path: "/speaker/frames",
      body: {
        type: "audio.frame",
        sessionId,
        sequence,
        timestampMs: Math.round(startSample / wav.sampleRate * 1000),
        format: "pcm16",
        sampleRate: wav.sampleRate,
        data: wav.pcm.subarray(startSample * 2, endSample * 2).toString("base64"),
      },
      fetchFn,
    });
    if (response.spans?.length && firstEvidenceAudioMs === null) {
      firstEvidenceAudioMs = observedAudioMs;
    }
    mergeSpeakerSpans(spans, response.spans ?? [], observedAudioMs);
    startSample = endSample;
  }
  const flushed = await requestJson({
    baseUrl,
    apiKey,
    path: `/speaker/sessions/${encodeURIComponent(sessionId)}/flush`,
    body: {},
    fetchFn,
  });
  mergeSpeakerSpans(spans, flushed.spans ?? [], wav.durationMs);
  return {
    firstEvidenceAudioMs,
    spans: [...spans.values()].sort((left, right) =>
      left.startMs - right.startMs ||
      left.speakerId.localeCompare(right.speakerId)
    ),
  };
}

async function requestJson({
  baseUrl,
  apiKey,
  path,
  body,
  method = "POST",
  fetchFn,
  expectJson = true,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetchFn(`${baseUrl.replace(/\/$/u, "")}${path}`, {
      method,
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Speaker service HTTP ${response.status} for ${path}`);
    }
    if (!expectJson) return {};
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

function sampleAt(wav, atMs) {
  return Math.max(
    0,
    Math.min(
      wav.pcm.length / 2,
      Math.round(atMs * wav.sampleRate / 1000),
    ),
  );
}

function validSpan(span) {
  return typeof span?.speakerId === "string" &&
    Number.isFinite(span.startMs) &&
    Number.isFinite(span.endMs) &&
    span.startMs >= 0 &&
    span.endMs > span.startMs;
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
