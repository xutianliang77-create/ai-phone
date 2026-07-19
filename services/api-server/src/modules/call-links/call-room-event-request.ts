import type { CallLinkRecord } from "./call-links.service.js";
import type {
  CallRoomDataEvent,
  CallRoomDataEventType,
} from "./call-room-events.js";
import { encodeCallRoomEvent } from "./call-room-events.js";
import {
  isSegmentTiming,
  isSpeechPipelineTiming,
  participantTrackSpeaker,
} from "@translation/contracts";
import type { SessionRecord } from "../sessions/session-record.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { getCallRoomResourceLimits } from "./call-room-resource-limits.js";
import {
  isEventType,
  isObject,
  isOptionalIdentifier,
  isOptionalNonNegativeInteger,
  isOptionalPipelineTiming,
  isOptionalPositiveInteger,
  isPlaybackBoundEventType,
  optionalBoolean,
  optionalDuplexMode,
  optionalNonNegativeInteger,
  optionalNumber,
  optionalPositiveInteger,
  optionalRatio,
  optionalRefinement,
  optionalString,
  optionalVersion,
  optionalVoiceMode,
  optionalWorkerStage,
} from "./call-room-event-validation.js";

const speakerRoles = new Set(["host", "guest", "worker"]);
const languages = new Set(["zh", "en"]);

export async function parseCallRoomEventRequest(
  body: unknown,
  record: CallLinkRecord,
): Promise<
  | { ok: true; events: CallRoomDataEvent[]; expectedVersion?: number }
  | { ok: false; code: string; message: string }
> {
  if (!isObject(body) || !Array.isArray(body.events) || body.events.length === 0) {
    return invalidEvent();
  }
  if (!matchesCallBinding(body, record)) return bindingConflict();
  const expectedVersion = optionalVersion(body.expectedVersion);
  if (body.expectedVersion !== undefined && expectedVersion === undefined) {
    return invalidEvent();
  }
  const limits = getCallRoomResourceLimits();
  if (body.events.length > limits.maxEventsPerRequest) {
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
    const event = await parseEvent(raw, record);
    if (!event) return invalidEvent();
    if (encodeCallRoomEvent(event).byteLength > limits.maxDataPacketBytes) {
      return {
        ok: false,
        code: "call_room_event_too_large",
        message: "Call room event exceeds the configured size limit",
      };
    }
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

async function parseEvent(
  raw: unknown,
  record: CallLinkRecord,
): Promise<CallRoomDataEvent | null> {
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
  if (
    !isOptionalIdentifier(raw.speechId) ||
    !isOptionalIdentifier(raw.turnId) ||
    !isOptionalNonNegativeInteger(raw.revision) ||
    !isOptionalPositiveInteger(raw.pipelineGeneration) ||
    !isOptionalPipelineTiming(raw.pipelineTiming)
  ) {
    return null;
  }
  const playback = isPlaybackBoundEventType(type)
    ? await parsePlaybackBinding(raw, record, String(speakerRole))
    : null;
  if (isPlaybackBoundEventType(type) && !playback) return null;
  return {
    type,
    callId: record.callId,
    roomName: record.roomName,
    segmentId,
    speechId: optionalString(raw.speechId),
    turnId: optionalString(raw.turnId),
    revision: optionalNonNegativeInteger(raw.revision),
    pipelineGeneration: optionalPositiveInteger(raw.pipelineGeneration),
    pipelineTiming: isSpeechPipelineTiming(raw.pipelineTiming)
      ? raw.pipelineTiming
      : undefined,
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

async function parsePlaybackBinding(
  raw: Record<string, unknown>,
  record: CallLinkRecord,
  sourceRole: string,
) {
  const playbackId = optionalString(raw.playbackId);
  const generation = optionalPositiveInteger(raw.generation);
  if (!playbackId || generation === undefined ||
    (sourceRole !== "host" && sourceRole !== "guest")) return null;
  const session = await findSession(record.sessionId);
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
  legs: SessionRecord["callLegs"],
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
