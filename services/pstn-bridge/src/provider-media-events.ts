import type { IncomingMessage, ServerResponse } from "node:http";
import { fromTelephonyMulaw8k } from "./audio-codec.js";
import type { ProviderEventDeduper } from "./provider-event-deduper.js";
import { verifyProviderWebhook } from "./provider-webhook-auth.js";
import type {
  PstnAudioFrameSink,
  PstnBridgeEnv,
  PstnMediaFrameRequest,
  TtsAudioSinkRequest,
} from "./types.js";

export async function handleProviderMediaEvent(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  audioFrameSink: PstnAudioFrameSink;
  providerEventDeduper: ProviderEventDeduper;
  hasAudioFrameSink: boolean;
}) {
  const rawBody = await readText(context.request);
  const auth = verifyProviderWebhook({
    headers: context.request.headers,
    body: rawBody,
    secret: context.config.providerWebhookSecret,
    maxSkewMs: context.config.providerWebhookMaxSkewMs,
  });
  if (!auth.ok) {
    sendJson(context.response, auth.statusCode, { error: { code: auth.code, message: auth.message } });
    return;
  }
  if (!context.hasAudioFrameSink) {
    sendJson(context.response, 503, {
      error: { code: "audio_frame_sink_not_configured", message: "audio frame sink is not configured" },
    });
    return;
  }
  const parsed = parseProviderMediaEvent(parseJson(rawBody));
  if (!parsed) {
    sendJson(context.response, 400, {
      error: { code: "invalid_provider_media_event", message: "invalid provider media event payload" },
    });
    return;
  }
  const { duplicate, result } = await context.providerEventDeduper.runOnce(
    scopedEventId("media", parsed.eventId),
    () => context.audioFrameSink.send({
      callId: parsed.frame.callId,
      providerCallId: parsed.frame.providerCallId,
      mediaStreamId: parsed.frame.mediaStreamId,
      sourceSpeakerRole: parsed.frame.sourceSpeakerRole,
      sequence: parsed.frame.sequence,
      timestampMs: parsed.frame.timestampMs,
      provider: parsed.frame.provider,
      audio: fromTelephonyMulaw8k(parsed.frame),
    }),
  );
  sendJson(context.response, 200, {
    status: duplicate ? "duplicate" : result?.status ?? "accepted",
    eventId: parsed.eventId,
    ...(duplicate ? {} : result),
  });
}

export function parseProviderMediaEvent(input: unknown): {
  eventId?: string;
  frame: PstnMediaFrameRequest;
} | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  if (body.eventType !== "media.frame") return null;
  const callId = text(body.callId, 120);
  const mediaStreamId = text(body.mediaStreamId, 160);
  const sourceSpeakerRole = speakerRole(body.sourceSpeakerRole);
  const sequence = Number.isInteger(body.sequence) && Number(body.sequence) >= 0
    ? Number(body.sequence)
    : null;
  const audio = parseTelephonyAudio(body.audio);
  if (!callId || !mediaStreamId || !sourceSpeakerRole || sequence === null || !audio) return null;
  return {
    ...optionalText("eventId", body.eventId, 160),
    frame: {
      callId,
      mediaStreamId,
      sourceSpeakerRole,
      sequence,
      audio,
      ...optionalText("providerCallId", body.providerCallId, 160),
      ...optionalText("provider", body.provider, 80),
      ...optionalNumber("timestampMs", body.timestampMs),
    },
  };
}

async function readText(request: IncomingMessage) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(rawBody: string) {
  try {
    return rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return null;
  }
}

function parseTelephonyAudio(input: unknown): PstnMediaFrameRequest["audio"] | null {
  if (!input || typeof input !== "object") return null;
  const audio = input as Record<string, unknown>;
  const data = text(audio.data, 2_000_000);
  return audio.encoding === "mulaw8k" && audio.sampleRate === 8000 && data
    ? {
      encoding: "mulaw8k",
      sampleRate: 8000,
      durationMs: typeof audio.durationMs === "number" && Number.isFinite(audio.durationMs)
        ? Math.max(0, audio.durationMs)
        : 0,
      data,
    }
    : null;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function optionalText(name: string, value: unknown, maxLength: number) {
  const valueText = text(value, maxLength);
  return valueText ? { [name]: valueText } : {};
}

function optionalNumber(name: string, value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { [name]: value }
    : {};
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : "";
}

function scopedEventId(scope: string, eventId: string | undefined) {
  return eventId ? `${scope}:${eventId}` : undefined;
}

function speakerRole(value: unknown): TtsAudioSinkRequest["sourceSpeakerRole"] | null {
  return value === "host" || value === "guest" ? value : null;
}
