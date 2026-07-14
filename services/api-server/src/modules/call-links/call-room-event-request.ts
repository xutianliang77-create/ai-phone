import type { CallLinkRecord } from "./call-links.service.js";
import type {
  CallRoomDataEvent,
  CallRoomDataEventType,
} from "./call-room-events.js";
import {
  isSegmentTiming,
  participantTrackSpeaker,
  type SessionSegmentRefinementDto,
} from "@translation/contracts";
import { findSession } from "../sessions/sessions.repository.js";

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
const speakerRoles = new Set(["host", "guest", "worker"]);
const languages = new Set(["zh", "en"]);
const workerStages = new Set(["worker", "asr", "translation", "tts"]);

export function parseCallRoomEventRequest(
  body: unknown,
  record: CallLinkRecord,
):
  | { ok: true; events: CallRoomDataEvent[]; expectedVersion?: number }
  | { ok: false; code: string; message: string } {
  if (!isObject(body) || !Array.isArray(body.events) || body.events.length === 0) {
    return invalidEvent();
  }
  if (!matchesCallBinding(body, record)) return bindingConflict();
  const expectedVersion = optionalVersion(body.expectedVersion);
  if (body.expectedVersion !== undefined && expectedVersion === undefined) {
    return invalidEvent();
  }
  if (body.events.length > 20) {
    return {
      ok: false,
      code: "too_many_call_room_events",
      message: "Too many call room events",
    };
  }

  const events: CallRoomDataEvent[] = [];
  for (const raw of body.events) {
    if (isObject(raw) && !matchesCallBinding(raw, record)) {
      return bindingConflict();
    }
    const event = parseEvent(raw, record);
    if (!event) return invalidEvent();
    events.push(event);
  }
  return { ok: true, events, ...(expectedVersion ? { expectedVersion } : {}) };
}

function matchesCallBinding(
  value: Record<string, unknown>,
  record: CallLinkRecord,
) {
  return matchesOptionalString(value.callId, record.callId) &&
    matchesOptionalString(value.sessionId, record.sessionId) &&
    matchesOptionalString(value.roomName, record.roomName);
}

function matchesOptionalString(value: unknown, expected: string) {
  return value === undefined || value === expected;
}

function bindingConflict() {
  return {
    ok: false,
    code: "call_link_binding_conflict",
    message: "Call event binding does not match the requested call link",
  } as const;
}

function parseEvent(raw: unknown, record: CallLinkRecord): CallRoomDataEvent | null {
  if (!isObject(raw)) return null;
  const type = raw.type;
  const segmentId = raw.segmentId;
  const speakerRole = raw.speakerRole;
  const sourceLanguage = raw.sourceLanguage;
  const targetLanguage = raw.targetLanguage;
  const text = raw.text;
  if (
    !isEventType(type) ||
    typeof segmentId !== "string" ||
    !speakerRoles.has(String(speakerRole)) ||
    !languages.has(String(sourceLanguage)) ||
    !languages.has(String(targetLanguage)) ||
    typeof text !== "string"
  ) {
    return null;
  }
  const playback = isPlaybackBoundEventType(type)
    ? parsePlaybackBinding(raw, record, String(speakerRole))
    : null;
  if (isPlaybackBoundEventType(type) && !playback) return null;
  return {
    type,
    callId: record.callId,
    roomName: record.roomName,
    segmentId,
    ...playback,
    speakerRole: speakerRole as CallRoomDataEvent["speakerRole"],
    speaker: participantTrackSpeaker(
      speakerRole as CallRoomDataEvent["speakerRole"],
    ),
    sourceLanguage: sourceLanguage as CallRoomDataEvent["sourceLanguage"],
    targetLanguage: targetLanguage as CallRoomDataEvent["targetLanguage"],
    text,
    sourceText: optionalString(raw.sourceText),
    rawText: optionalString(raw.rawText),
    optimizedText: optionalString(raw.optimizedText),
    translatedText: optionalString(raw.translatedText),
    confidence: optionalRatio(raw.confidence),
    refinement: optionalRefinement(raw.refinement),
    timing: isSegmentTiming(raw.timing) ? raw.timing : undefined,
    provider: optionalString(raw.provider),
    model: optionalString(raw.model),
    voiceMode: optionalVoiceMode(raw.voiceMode),
    voiceProfileId: optionalString(raw.voiceProfileId),
    stage: optionalWorkerStage(raw.stage),
    retryable: optionalBoolean(raw.retryable),
    firstAudioMs: optionalNumber(raw.firstAudioMs),
    audioDurationMs: optionalNumber(raw.audioDurationMs),
    playbackReason: optionalString(raw.playbackReason),
    duplexMode: optionalDuplexMode(raw.duplexMode),
    degradationReason: optionalString(raw.degradationReason),
    vadProvider: optionalString(raw.vadProvider),
    vadProbability: optionalRatio(raw.vadProbability),
    speechDurationMs: optionalNumber(raw.speechDurationMs),
    preRollMs: optionalNumber(raw.preRollMs),
    stopLatencyMs: optionalNumber(raw.stopLatencyMs),
    timestampMs: typeof raw.timestampMs === "number" ? raw.timestampMs : Date.now(),
  };
}

function parsePlaybackBinding(
  raw: Record<string, unknown>,
  record: CallLinkRecord,
  sourceRole: string,
) {
  const playbackId = optionalString(raw.playbackId);
  const generation = optionalPositiveInteger(raw.generation);
  if (!playbackId || generation === undefined ||
    (sourceRole !== "host" && sourceRole !== "guest")) return null;
  const session = findSession(record.sessionId);
  if (!session) return null;
  const existing = session.playbacks?.find((item) => item.id === playbackId);
  const targetRole = sourceRole === "host" ? "guest" : "host";
  const sourceLegId = existing?.sourceLegId ?? resolveActiveLeg(
    session.callLegs ?? [],
    sourceRole,
    raw.sourceLegId,
  );
  const targetLegId = existing?.targetLegId ?? resolveActiveLeg(
    session.callLegs ?? [],
    targetRole,
    raw.targetLegId,
  );
  if (!sourceLegId || !targetLegId) return null;
  if (!matchesOptionalString(raw.sourceLegId, sourceLegId) ||
    !matchesOptionalString(raw.targetLegId, targetLegId)) return null;
  return { playbackId, generation, sourceLegId, targetLegId };
}

function resolveActiveLeg(
  legs: NonNullable<ReturnType<typeof findSession>>["callLegs"],
  role: string,
  requestedId: unknown,
) {
  const matches = (legs ?? []).filter((leg) =>
    leg.status === "active" && leg.participantRole === role
  );
  if (typeof requestedId === "string") {
    return matches.some((leg) => leg.id === requestedId) ? requestedId : null;
  }
  return matches.length === 1 ? matches[0]?.id ?? null : null;
}

function invalidEvent() {
  return {
    ok: false,
    code: "invalid_call_room_event",
    message: "Invalid call room event",
  } as const;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventType(value: unknown): value is CallRoomDataEventType {
  return typeof value === "string" && eventTypes.has(value as CallRoomDataEventType);
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalVersion(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

function optionalPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

function optionalRatio(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function optionalRefinement(value: unknown): SessionSegmentRefinementDto | undefined {
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

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalWorkerStage(value: unknown) {
  return typeof value === "string" && workerStages.has(value)
    ? value as CallRoomDataEvent["stage"]
    : undefined;
}

function optionalVoiceMode(value: unknown) {
  return value === "preset" ||
    value === "voice_design" ||
    value === "personal_clone" ||
    value === "ultimate_clone"
    ? value as CallRoomDataEvent["voiceMode"]
    : undefined;
}

function isPlaybackEventType(type: CallRoomDataEventType) {
  return type.startsWith("playback.");
}

function isPlaybackBoundEventType(type: CallRoomDataEventType) {
  return isPlaybackEventType(type) || type.startsWith("barge_in.");
}

function optionalDuplexMode(value: unknown) {
  return value === "full_duplex" || value === "half_duplex" ||
      value === "captions_only"
    ? value as CallRoomDataEvent["duplexMode"]
    : undefined;
}
