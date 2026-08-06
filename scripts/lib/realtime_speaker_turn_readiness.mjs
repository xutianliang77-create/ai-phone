import { readFileSync } from "node:fs";

export function readPcm16MonoWav(path) {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Invalid WAV container: ${path}`);
  }

  let format;
  let pcm;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkSize;
    if (end > buffer.length) throw new Error(`Invalid WAV chunk: ${path}`);
    if (chunkId === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(start),
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      };
    } else if (chunkId === "data") {
      pcm = buffer.subarray(start, end);
    }
    offset = end + (chunkSize % 2);
  }

  if (!format || format.audioFormat !== 1 || format.channels !== 1 ||
      format.bitsPerSample !== 16 || !pcm) {
    throw new Error(`WAV must be mono PCM16: ${path}`);
  }
  if (format.sampleRate !== 16_000 && format.sampleRate !== 24_000) {
    throw new Error(`Unsupported WAV sample rate ${format.sampleRate}: ${path}`);
  }
  return { pcm, sampleRate: format.sampleRate };
}

export function joinNoGapWavFixtures(paths) {
  const fixtures = paths.map(readPcm16MonoWav);
  const sampleRate = fixtures[0]?.sampleRate;
  if (!sampleRate || fixtures.some((fixture) => fixture.sampleRate !== sampleRate)) {
    throw new Error("Speaker fixtures must use the same sample rate");
  }
  return {
    sampleRate,
    pcm: Buffer.concat(fixtures.map((fixture) => fixture.pcm)),
  };
}

export function evaluateRealtimeSpeakerTurnReadiness(input, options = {}) {
  const errors = [];
  const { gatewayHealth, speakerHealth, detail } = input;
  const expectedSpeakerCount = options.expectedSpeakerCount ?? 2;
  const requireBoundary = options.requireBoundary ?? expectedSpeakerCount > 1;
  const requiredLanguages = options.requiredLanguages ?? ["zh", "en"];
  const maximumHistoryLatencyMs = options.maximumHistoryLatencyMs ?? 1500;
  if (gatewayHealth?.speakerProvider !== "http") {
    errors.push(`Gateway speakerProvider is ${gatewayHealth?.speakerProvider ?? "missing"}`);
  }
  if (gatewayHealth?.sessionEventSink !== "api") {
    errors.push(`Gateway sessionEventSink is ${gatewayHealth?.sessionEventSink ?? "missing"}`);
  }
  if (speakerHealth?.provider !== "sortformer" || speakerHealth?.mode !== "active") {
    errors.push(
      `Speaker service must be sortformer/active; got ` +
      `${speakerHealth?.provider ?? "missing"}/${speakerHealth?.mode ?? "missing"}`,
    );
  }
  if (detail?.status !== "ended") errors.push(`Session status is ${detail?.status ?? "missing"}`);
  if (input.endDelivery) {
    if (!input.endDelivery.historyReady) {
      errors.push("Session end was not persisted");
    } else if (!Number.isFinite(input.endDelivery.historyLatencyMs) ||
      input.endDelivery.historyLatencyMs > maximumHistoryLatencyMs) {
      errors.push(
        `Session end persistence took ${input.endDelivery.historyLatencyMs}ms; ` +
        `maximum is ${maximumHistoryLatencyMs}ms`,
      );
    }
  }

  const ordered = [...(detail?.segments ?? [])]
    .filter((segment) => segment.sourceText?.trim() && segment.speaker?.speakerId)
    .sort((left, right) =>
      (left.timing?.startMs ?? Number.MAX_SAFE_INTEGER) -
      (right.timing?.startMs ?? Number.MAX_SAFE_INTEGER));
  const speakerIds = unique(ordered.map((segment) => segment.speaker.speakerId)
    .filter((speakerId) => speakerId !== "unknown"));
  const turnIds = unique(ordered.map((segment) => segment.turnId).filter(Boolean));
  if (speakerIds.length !== expectedSpeakerCount) {
    errors.push(
      `Expected ${expectedSpeakerCount} speakers, got ` +
      `${speakerIds.join(",") || "none"}`,
    );
  }
  if (turnIds.length < expectedSpeakerCount) {
    errors.push(
      `Expected at least ${expectedSpeakerCount} turns, got ` +
      `${turnIds.join(",") || "none"}`,
    );
  }

  const first = ordered[0];
  const switched = ordered.find((segment) =>
    first && segment.speaker.speakerId !== first.speaker.speakerId);
  if (!first) errors.push("No attributed transcript was persisted");
  if (expectedSpeakerCount > 1 && !switched) {
    errors.push("No chronological speaker switch was persisted");
  }
  for (const segment of [first, switched].filter(Boolean)) {
    if (!segment.translatedText?.trim()) {
      errors.push(`Segment ${segment.id} has no translation`);
    }
  }

  const dominantLanguages = unique(ordered.map((segment) => segment.dominantLanguage)
    .filter(Boolean));
  const missingLanguages = requiredLanguages.filter((language) =>
    !dominantLanguages.includes(language)
  );
  if (missingLanguages.length > 0) {
    errors.push(
      `Expected ${requiredLanguages.join("/")} language profiles, got ` +
      `${dominantLanguages.join(",") || "none"}`,
    );
  }

  const diagnostics = detail?.diagnostics?.speakerTurns;
  if (!diagnostics) {
    errors.push("Speaker diagnostics are missing");
  } else if (requireBoundary) {
    if (diagnostics.confirmedBoundaryCount < 1) {
      errors.push("No confirmed speaker boundary was recorded");
    }
    if (diagnostics.commitHitCount < 1) errors.push("Speaker boundary commit did not hit");
    if (diagnostics.commitMissCount !== 0) errors.push("Speaker boundary commit miss is nonzero");
    if (diagnostics.commitErrorCount !== 0) errors.push("Speaker boundary commit error is nonzero");
    if (diagnostics.endpointRaceCount !== 0) errors.push("Speaker endpoint race is nonzero");
  } else if (diagnostics.confirmedBoundaryCount !== 0) {
    errors.push("Unexpected speaker boundary was recorded");
  }
  if ((detail?.diagnostics?.audio?.droppedFrameCount ?? 0) !== 0) {
    errors.push("Realtime audio frames were dropped");
  }

  return {
    ok: errors.length === 0,
    errors,
    speakerIds,
    turnIds,
    dominantLanguages,
    segmentCount: ordered.length,
    diagnostics: detail?.diagnostics ?? null,
  };
}

function unique(values) {
  return [...new Set(values)];
}
