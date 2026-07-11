import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { CallTranslationWorker } from "./call-translation-worker.js";
import type { CallAudioFrame, CallAudioSpeakerRole } from "./types.js";

export interface PstnAudioFrameServerOptions {
  apiKey?: string;
  worker: Pick<CallTranslationWorker, "startCall" | "processAudioFrame" | "flushSpeaker" | "endCall">;
  nowMs?: () => number;
}

interface PstnAudioFrameRequest {
  callId: string;
  mediaStreamId?: string;
  sourceSpeakerRole: CallAudioSpeakerRole;
  sequence: number;
  timestampMs?: number;
  audio: {
    format: "pcm16";
    sampleRate: 16000;
    data: string;
  };
}

interface PstnAudioFrameFlushRequest {
  callId: string;
  sourceSpeakerRole?: CallAudioSpeakerRole;
}

export function buildPstnAudioFrameServer(options: PstnAudioFrameServerOptions) {
  const dispatcher = new PstnAudioFrameDispatcher(options.worker, options.nowMs);
  return createServer(async (request, response) => {
    try {
      await handleRequest({ request, response, options, dispatcher });
    } catch (error) {
      sendJson(response, 500, {
        error: { code: "pstn_audio_frame_sink_error", message: errorMessage(error) },
      });
    }
  });
}

export class PstnAudioFrameDispatcher {
  private readonly startedCalls = new Set<string>();
  private readonly seenFrames = new Set<string>();

  constructor(
    private readonly worker: PstnAudioFrameServerOptions["worker"],
    private readonly nowMs: (() => number) | undefined,
  ) {}

  async accept(input: PstnAudioFrameRequest) {
    const frameId = `${input.callId}:${input.sourceSpeakerRole}:${input.sequence}`;
    if (this.seenFrames.has(frameId)) return { status: "dropped" as const, acceptedFrameId: frameId };

    if (!this.startedCalls.has(input.callId)) {
      await this.worker.startCall(input.callId);
      this.startedCalls.add(input.callId);
    }

    this.seenFrames.add(frameId);
    await this.worker.processAudioFrame(toCallAudioFrame(input, this.nowMs));
    return { status: "accepted" as const, acceptedFrameId: frameId };
  }

  async flush(input: PstnAudioFrameFlushRequest) {
    if (!this.startedCalls.has(input.callId)) return { status: "dropped" as const };
    if (input.sourceSpeakerRole) {
      await this.worker.flushSpeaker(input.callId, input.sourceSpeakerRole);
    } else {
      await this.worker.flushSpeaker(input.callId, "host");
      await this.worker.flushSpeaker(input.callId, "guest");
    }
    return { status: "flushed" as const };
  }

  async end(callId: string) {
    if (!this.startedCalls.has(callId)) return { status: "dropped" as const };
    await this.worker.endCall(callId);
    this.startedCalls.delete(callId);
    for (const frameId of this.seenFrames) {
      if (frameId.startsWith(`${callId}:`)) this.seenFrames.delete(frameId);
    }
    return { status: "ended" as const };
  }
}

async function handleRequest(context: {
  request: IncomingMessage;
  response: ServerResponse;
  options: PstnAudioFrameServerOptions;
  dispatcher: PstnAudioFrameDispatcher;
}) {
  const { request, response, options, dispatcher } = context;
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "translation-worker-pstn-audio-frame-sink",
      version: "0.1.0",
      configured: Boolean(options.apiKey),
    });
    return;
  }
  if (!isPstnRoute(request.url)) {
    sendJson(response, 404, { error: { code: "not_found", message: "not found" } });
    return;
  }
  if (!authorize(request, response, options.apiKey)) return;

  if (request.method === "POST" && request.url === "/pstn/audio-frames") {
    const body = parseFrame(await readJson(request));
    if (!body) {
      sendJson(response, 400, {
        error: { code: "invalid_pstn_audio_frame", message: "invalid PSTN audio frame payload" },
      });
      return;
    }
    sendJson(response, 200, await dispatcher.accept(body));
    return;
  }
  if (request.method === "POST" && request.url === "/pstn/audio-frames/flush") {
    const body = parseFlush(await readJson(request));
    if (!body) {
      sendJson(response, 400, {
        error: { code: "invalid_pstn_audio_flush", message: "invalid PSTN audio flush payload" },
      });
      return;
    }
    sendJson(response, 200, await dispatcher.flush(body));
    return;
  }
  if (request.method === "POST" && request.url === "/pstn/audio-frames/end") {
    const callId = parseCallId(await readJson(request));
    if (!callId) {
      sendJson(response, 400, {
        error: { code: "invalid_pstn_audio_end", message: "invalid PSTN audio end payload" },
      });
      return;
    }
    sendJson(response, 200, await dispatcher.end(callId));
    return;
  }
  sendJson(response, 404, { error: { code: "not_found", message: "not found" } });
}

function isPstnRoute(url: string | undefined) {
  return url?.startsWith("/pstn/audio-frames") ?? false;
}

function authorize(request: IncomingMessage, response: ServerResponse, apiKey: string | undefined) {
  if (!apiKey) {
    sendJson(response, 503, {
      error: {
        code: "pstn_audio_frame_sink_not_configured",
        message: "TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY is required",
      },
    });
    return false;
  }
  if (request.headers.authorization !== `Bearer ${apiKey}`) {
    sendJson(response, 401, {
      error: { code: "invalid_pstn_audio_frame_sink_key", message: "invalid audio frame sink key" },
    });
    return false;
  }
  return true;
}

function parseFrame(input: unknown): PstnAudioFrameRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const callId = text(body.callId, 120);
  const sourceSpeakerRole = speakerRole(body.sourceSpeakerRole);
  const sequence = positiveInteger(body.sequence);
  const audio = parseAudio(body.audio);
  if (!callId || !sourceSpeakerRole || sequence === null || !audio) return null;
  return {
    callId,
    sourceSpeakerRole,
    sequence,
    audio,
    ...optionalText("mediaStreamId", body.mediaStreamId, 160),
    ...optionalNumber("timestampMs", body.timestampMs),
  };
}

function parseFlush(input: unknown): PstnAudioFrameFlushRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const callId = text(body.callId, 120);
  if (!callId) return null;
  return { callId, ...optionalSpeakerRole("sourceSpeakerRole", body.sourceSpeakerRole) };
}

function parseCallId(input: unknown) {
  if (!input || typeof input !== "object") return null;
  return text((input as Record<string, unknown>).callId, 120);
}

function parseAudio(input: unknown): PstnAudioFrameRequest["audio"] | null {
  if (!input || typeof input !== "object") return null;
  const audio = input as Record<string, unknown>;
  const data = text(audio.data, 2_000_000);
  if (audio.format !== "pcm16" || audio.sampleRate !== 16000 || !data) return null;
  return { format: "pcm16", sampleRate: 16000, data };
}

function toCallAudioFrame(input: PstnAudioFrameRequest, nowMs: (() => number) | undefined): CallAudioFrame {
  return {
    type: "audio.frame",
    sessionId: input.callId,
    speakerRole: input.sourceSpeakerRole,
    sequence: input.sequence,
    timestampMs: input.timestampMs ?? nowMs?.() ?? Date.now(),
    format: "pcm16",
    sampleRate: input.audio.sampleRate,
    data: input.audio.data,
  };
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function speakerRole(value: unknown): CallAudioSpeakerRole | null {
  return value === "host" || value === "guest" ? value : null;
}

function optionalSpeakerRole(name: string, value: unknown) {
  const role = speakerRole(value);
  return role ? { [name]: role } : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalNumber(name: string, value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? { [name]: parsed } : {};
}

function optionalText(name: string, value: unknown, maxLength: number) {
  const parsed = text(value, maxLength);
  return parsed ? { [name]: parsed } : {};
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
