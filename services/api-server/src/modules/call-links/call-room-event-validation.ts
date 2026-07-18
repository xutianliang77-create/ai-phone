import {
  isSpeechPipelineTiming,
  type SessionSegmentRefinementDto,
} from "@translation/contracts";
import type {
  CallRoomDataEvent,
  CallRoomDataEventType,
} from "./call-room-events.js";

const eventTypes = new Set<CallRoomDataEventType>([
  "worker.status",
  "transcript.final",
  "translation.final",
  "tts.ready",
  "playback.queued",
  "playback.started",
  "playback.interrupted",
  "playback.ended",
  "playback.failed",
  "barge_in.detected",
  "barge_in.confirmed",
  "pipeline.degraded",
  "pipeline.restored",
]);
const workerStages = new Set(["worker", "asr", "translation", "tts"]);

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isEventType(value: unknown): value is CallRoomDataEventType {
  return typeof value === "string" &&
    eventTypes.has(value as CallRoomDataEventType);
}

export function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

export function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function optionalVersion(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

export function optionalPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

export function optionalNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

export function isOptionalNonNegativeInteger(value: unknown) {
  return value === undefined || optionalNonNegativeInteger(value) !== undefined;
}

export function isOptionalPositiveInteger(value: unknown) {
  return value === undefined || optionalPositiveInteger(value) !== undefined;
}

export function isOptionalIdentifier(value: unknown) {
  return value === undefined ||
    typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

export function isOptionalPipelineTiming(value: unknown) {
  return value === undefined || isSpeechPipelineTiming(value);
}

export function optionalRatio(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) &&
      value >= 0 && value <= 1
    ? value
    : undefined;
}

export function optionalRefinement(
  value: unknown,
): SessionSegmentRefinementDto | undefined {
  if (!isObject(value)) return undefined;
  const operations = optionalStringArray(value.operations);
  const protectedTermsKept = optionalStringArray(value.protectedTermsKept);
  const warnings = optionalStringArray(value.warnings);
  const confidence = optionalRatio(value.confidence);
  const latencyMs = optionalNumber(value.latencyMs);
  if (
    typeof value.provider !== "string" ||
    typeof value.promptVersion !== "string" ||
    confidence === undefined ||
    latencyMs === undefined ||
    !operations ||
    !protectedTermsKept ||
    !warnings
  ) return undefined;
  return {
    provider: value.provider,
    model: optionalString(value.model),
    promptVersion: value.promptVersion,
    confidence,
    latencyMs,
    operations,
    protectedTermsKept,
    warnings,
    fallbackReason: optionalString(value.fallbackReason),
  };
}

function optionalStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value as string[]
    : undefined;
}

export function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

export function optionalWorkerStage(value: unknown) {
  return typeof value === "string" && workerStages.has(value)
    ? value as CallRoomDataEvent["stage"]
    : undefined;
}

export function optionalVoiceMode(value: unknown) {
  return value === "preset" ||
    value === "voice_design" ||
    value === "personal_clone" ||
    value === "ultimate_clone"
    ? value as CallRoomDataEvent["voiceMode"]
    : undefined;
}

export function isPlaybackBoundEventType(type: CallRoomDataEventType) {
  return type.startsWith("playback.") || type.startsWith("barge_in.");
}

export function optionalDuplexMode(value: unknown) {
  return value === "full_duplex" || value === "half_duplex" ||
      value === "captions_only"
    ? value as CallRoomDataEvent["duplexMode"]
    : undefined;
}
