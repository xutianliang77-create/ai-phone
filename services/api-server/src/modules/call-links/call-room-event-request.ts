import type { CallLinkRecord } from "./call-links.service.js";
import type {
  CallRoomDataEvent,
  CallRoomDataEventType,
} from "./call-room-events.js";

const eventTypes = new Set<CallRoomDataEventType>([
  "worker.status",
  "transcript.final",
  "translation.final",
  "tts.ready",
]);
const speakerRoles = new Set(["host", "guest", "worker"]);
const languages = new Set(["zh", "en"]);
const workerStages = new Set(["worker", "asr", "translation", "tts"]);

export function parseCallRoomEventRequest(
  body: unknown,
  record: CallLinkRecord,
):
  | { ok: true; events: CallRoomDataEvent[] }
  | { ok: false; code: string; message: string } {
  if (!isObject(body) || !Array.isArray(body.events) || body.events.length === 0) {
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
    const event = parseEvent(raw, record);
    if (!event) return invalidEvent();
    events.push(event);
  }
  return { ok: true, events };
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
  return {
    type,
    callId: record.callId,
    roomName: record.roomName,
    segmentId,
    speakerRole: speakerRole as CallRoomDataEvent["speakerRole"],
    sourceLanguage: sourceLanguage as CallRoomDataEvent["sourceLanguage"],
    targetLanguage: targetLanguage as CallRoomDataEvent["targetLanguage"],
    text,
    sourceText: optionalString(raw.sourceText),
    translatedText: optionalString(raw.translatedText),
    provider: optionalString(raw.provider),
    model: optionalString(raw.model),
    voiceMode: optionalVoiceMode(raw.voiceMode),
    voiceProfileId: optionalString(raw.voiceProfileId),
    stage: optionalWorkerStage(raw.stage),
    retryable: optionalBoolean(raw.retryable),
    firstAudioMs: optionalNumber(raw.firstAudioMs),
    audioDurationMs: optionalNumber(raw.audioDurationMs),
    timestampMs: typeof raw.timestampMs === "number" ? raw.timestampMs : Date.now(),
  };
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
