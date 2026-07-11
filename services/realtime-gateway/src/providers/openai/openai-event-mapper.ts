import type {
  LanguageCode,
  ServerRealtimeEvent,
  TranslationLanguageCode,
} from "@translation/contracts";

export interface OpenAiMapperContext {
  sessionId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TranslationLanguageCode;
}

type OpenAiRealtimeEvent = Record<string, unknown> & { type?: string };

export function mapOpenAiRealtimeEvent(
  event: OpenAiRealtimeEvent,
  context: OpenAiMapperContext,
): ServerRealtimeEvent[] {
  const text = readText(event);
  const segmentId = readSegmentId(event);

  if (event.type === "session.input_transcript.delta" && text) {
    return [{
      type: "transcript.partial",
      sessionId: context.sessionId,
      segmentId,
      text,
      language: inferSourceLanguage(context),
    }];
  }
  if (event.type === "session.input_transcript.done" && text) {
    return [{
      type: "transcript.final",
      sessionId: context.sessionId,
      segmentId,
      text,
      language: inferSourceLanguage(context),
    }];
  }
  if (event.type === "session.output_transcript.delta" && text) {
    return [{
      type: "translation.delta",
      sessionId: context.sessionId,
      segmentId,
      text,
      language: context.targetLanguage,
    }];
  }
  if (event.type === "session.output_transcript.done" && text) {
    return [{
      type: "translation.final",
      sessionId: context.sessionId,
      segmentId,
      text,
      language: context.targetLanguage,
    }];
  }
  if (event.type === "error") {
    return [{
      type: "error",
      sessionId: context.sessionId,
      code: "provider_unavailable",
      message: readErrorMessage(event),
    }];
  }
  return [];
}

function inferSourceLanguage(context: OpenAiMapperContext) {
  if (context.sourceLanguage !== "auto") return context.sourceLanguage;
  return context.targetLanguage === "zh" ? "en" : "zh";
}

function readText(event: OpenAiRealtimeEvent) {
  return readString(event, "delta") ??
    readString(event, "transcript") ??
    readString(event, "text");
}

function readSegmentId(event: OpenAiRealtimeEvent) {
  return readString(event, "item_id") ??
    readString(event, "response_id") ??
    readString(event, "event_id") ??
    "openai_segment";
}

function readErrorMessage(event: OpenAiRealtimeEvent) {
  const error = event.error;
  if (isRecord(error)) {
    return readString(error, "message") ?? "OpenAI realtime translation error";
  }
  return "OpenAI realtime translation error";
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
