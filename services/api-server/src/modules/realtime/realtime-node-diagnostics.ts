import type {
  RealtimeAudioLegDiagnosticsDto,
  RealtimeModelFingerprintDto,
  RealtimeNodeDiagnosticsDto,
  RealtimeRtcDiagnosticsDto,
  RealtimeRtcSampleDto,
} from "@translation/contracts";

const MAX_AUDIO_LEGS = 16;
const MAX_RTC_SAMPLES = 120;
const MAX_MODEL_FINGERPRINTS = 8;

export function parseRealtimeNodeDiagnostics(
  value: unknown,
): RealtimeNodeDiagnosticsDto | undefined {
  if (!isRecord(value) || !boundedString(value.nodeId, 128) ||
    !boundedString(value.runtimeId, 128) || !isTimestamp(value.startedAtMs) ||
    !isTimestamp(value.endedAtMs) || value.endedAtMs < value.startedAtMs ||
    !optionalPositiveInteger(value.generation) ||
    !Array.isArray(value.audioLegs) || value.audioLegs.length > MAX_AUDIO_LEGS ||
    !Array.isArray(value.modelFingerprints) ||
    value.modelFingerprints.length > MAX_MODEL_FINGERPRINTS) return undefined;
  const audioLegs = value.audioLegs.map(parseAudioLeg);
  const modelFingerprints = value.modelFingerprints.map(parseModelFingerprint);
  if (audioLegs.some((item) => !item) || modelFingerprints.some((item) => !item) ||
    new Set(audioLegs.map((item) => item!.legId)).size !== audioLegs.length) {
    return undefined;
  }
  const rtc = value.rtc === undefined
    ? undefined : parseRtc(value.rtc, value.startedAtMs, value.endedAtMs);
  if (value.rtc !== undefined && !rtc) return undefined;
  return {
    nodeId: value.nodeId,
    runtimeId: value.runtimeId,
    ...(value.generation === undefined ? {} : { generation: value.generation }),
    startedAtMs: value.startedAtMs,
    endedAtMs: value.endedAtMs,
    audioLegs: audioLegs as RealtimeAudioLegDiagnosticsDto[],
    ...(rtc ? { rtc } : {}),
    modelFingerprints: modelFingerprints as RealtimeModelFingerprintDto[],
  };
}

function parseAudioLeg(value: unknown): RealtimeAudioLegDiagnosticsDto | undefined {
  if (!isRecord(value) || !boundedString(value.legId, 128) ||
    !["host", "guest"].includes(String(value.speakerRole)) ||
    !["drop_oldest", "reject_newest"].includes(String(value.dropPolicy))) {
    return undefined;
  }
  const keys = [
    "capacityFrames", "receivedFrames", "dequeuedFrames", "processedFrames",
    "failedFrames", "inFlightFrames", "droppedFrames", "overflowDroppedFrames",
    "shutdownDiscardedFrames", "sequenceGapFrames", "queueDepthFrames",
    "highWatermarkFrames", "backpressureEvents",
  ] as const;
  if (!keys.every((key) => isCount(value[key])) ||
    !["firstReceivedSequence", "lastReceivedSequence", "lastProcessedSequence"]
      .every((key) => optionalCount(value[key])) ||
    value.capacityFrames < 1 || value.queueDepthFrames > value.capacityFrames ||
    value.highWatermarkFrames > value.capacityFrames ||
    value.inFlightFrames !== value.dequeuedFrames - value.processedFrames -
      value.failedFrames ||
    value.droppedFrames !== value.overflowDroppedFrames +
      value.shutdownDiscardedFrames ||
    value.receivedFrames !== value.dequeuedFrames + value.droppedFrames +
      value.queueDepthFrames) return undefined;
  return {
    legId: value.legId,
    speakerRole: value.speakerRole as "host" | "guest",
    dropPolicy: value.dropPolicy as "drop_oldest" | "reject_newest",
    ...Object.fromEntries(keys.map((key) => [key, value[key]])),
    ...(value.firstReceivedSequence === undefined
      ? {} : { firstReceivedSequence: value.firstReceivedSequence }),
    ...(value.lastReceivedSequence === undefined
      ? {} : { lastReceivedSequence: value.lastReceivedSequence }),
    ...(value.lastProcessedSequence === undefined
      ? {} : { lastProcessedSequence: value.lastProcessedSequence }),
  } as RealtimeAudioLegDiagnosticsDto;
}

function parseRtc(
  value: unknown,
  startedAtMs: number,
  endedAtMs: number,
): RealtimeRtcDiagnosticsDto | undefined {
  if (!isRecord(value) || !isCount(value.attemptedSampleCount) ||
    !isCount(value.unavailableSampleCount) || !isCount(value.discardedSampleCount) ||
    !Array.isArray(value.samples) ||
    value.samples.length > MAX_RTC_SAMPLES ||
    value.attemptedSampleCount !== value.unavailableSampleCount +
      value.discardedSampleCount + value.samples.length) return undefined;
  const samples = value.samples.map((item) => parseRtcSample(
    item,
    startedAtMs,
    endedAtMs,
  ));
  if (samples.some((item) => !item)) return undefined;
  const orderedSamples = (samples as RealtimeRtcSampleDto[])
    .sort((left, right) => left.observedAtMs - right.observedAtMs);
  return {
    attemptedSampleCount: value.attemptedSampleCount,
    unavailableSampleCount: value.unavailableSampleCount,
    discardedSampleCount: value.discardedSampleCount,
    samples: orderedSamples,
  };
}

function parseRtcSample(
  value: unknown,
  startedAtMs: number,
  endedAtMs: number,
): RealtimeRtcSampleDto | undefined {
  if (!isRecord(value) || !isTimestamp(value.observedAtMs) ||
    value.observedAtMs < startedAtMs || value.observedAtMs > endedAtMs ||
    !optionalMetric(value.rttMs) || !optionalMetric(value.jitterMs) ||
    !optionalCount(value.packetsReceived) || !optionalCount(value.packetsLost) ||
    [value.rttMs, value.jitterMs, value.packetsReceived, value.packetsLost]
      .every((item) => item === undefined)) return undefined;
  return {
    observedAtMs: value.observedAtMs,
    ...(value.rttMs === undefined ? {} : { rttMs: value.rttMs }),
    ...(value.jitterMs === undefined ? {} : { jitterMs: value.jitterMs }),
    ...(value.packetsReceived === undefined
      ? {} : { packetsReceived: value.packetsReceived }),
    ...(value.packetsLost === undefined ? {} : { packetsLost: value.packetsLost }),
  };
}

function parseModelFingerprint(
  value: unknown,
): RealtimeModelFingerprintDto | undefined {
  if (!isRecord(value) ||
    !["pipeline", "asr", "translation", "tts"].includes(String(value.stage)) ||
    !boundedString(value.provider, 128) || !optionalBoundedString(value.model, 256) ||
    !optionalBoundedString(value.profile, 128) || !isFingerprint(value.fingerprint)) {
    return undefined;
  }
  return {
    stage: value.stage as RealtimeModelFingerprintDto["stage"],
    provider: value.provider,
    ...(value.model ? { model: value.model } : {}),
    ...(value.profile ? { profile: value.profile } : {}),
    fingerprint: value.fingerprint,
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalCount(value: unknown) {
  return value === undefined || isCount(value);
}

function optionalPositiveInteger(value: unknown) {
  return value === undefined || isCount(value) && value > 0;
}

function isTimestamp(value: unknown): value is number {
  return isCount(value);
}

function optionalMetric(value: unknown) {
  return value === undefined || typeof value === "number" &&
    Number.isFinite(value) && value >= 0 && value <= 3_600_000;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function optionalBoundedString(value: unknown, maximum: number) {
  return value === undefined || boundedString(value, maximum);
}

function isFingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
