import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  PlaybackInterruptRequest,
  PstnBridgeEnv,
  PstnProvider,
} from "./types.js";

export async function handlePstnPlaybackControl(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  provider: PstnProvider;
}) {
  const { request, response, config, provider } = context;
  if (request.method === "GET" &&
    request.url === "/internal/playback-sinks/pstn/capabilities") {
    if (!authorizeInternal(request, response, config)) return true;
    sendJson(response, 200, provider.playbackCapabilities ?? noClearCapabilities());
    return true;
  }

  const route = request.method === "POST"
    ? interruptPlaybackRoute(request.url)
    : null;
  if (!route) return false;
  if (!authorizeInternal(request, response, config)) return true;

  const body = parsePlaybackInterruptRequest(await readJson(request), route);
  if (!body) {
    sendError(response, 400, "invalid_playback_interrupt", "invalid playback interrupt payload");
    return true;
  }
  if (!provider.playbackCapabilities?.clearPlayback || !provider.interruptPlayback) {
    sendError(response, 409, "playback_clear_unsupported", "PSTN provider does not support playback clear");
    return true;
  }
  sendJson(response, 200, await provider.interruptPlayback(body));
  return true;
}

function parsePlaybackInterruptRequest(
  input: unknown,
  route: { callId: string; playbackId: string },
): PlaybackInterruptRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const sessionId = text(body.sessionId, 120);
  const targetLegId = text(body.targetLegId, 160);
  const generation = positiveInteger(body.generation);
  const idempotencyKey = text(body.idempotencyKey, 240);
  const reason = playbackInterruptReason(body.reason);
  if (sessionId !== route.callId || !targetLegId || !generation ||
    !idempotencyKey || !reason) return null;
  return { ...route, sessionId, targetLegId, generation, idempotencyKey, reason };
}

function interruptPlaybackRoute(url: string | undefined) {
  const match = /^\/internal\/calls\/([^/]+)\/playbacks\/([^/]+)\/interrupt$/.exec(url ?? "");
  if (!match) return null;
  try {
    return {
      callId: decodeURIComponent(match[1]),
      playbackId: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function authorizeInternal(
  request: IncomingMessage,
  response: ServerResponse,
  config: PstnBridgeEnv,
) {
  if (!config.apiKey) {
    sendError(response, 503, "pstn_bridge_not_configured", "PSTN_BRIDGE_API_KEY is required");
    return false;
  }
  if (request.headers.authorization !== `Bearer ${config.apiKey}`) {
    sendError(response, 401, "invalid_bridge_api_key", "invalid bridge api key");
    return false;
  }
  return true;
}

async function readJson(request: IncomingMessage) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : null;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, statusCode: number, code: string, message: string) {
  sendJson(response, statusCode, { error: { code, message } });
}

function noClearCapabilities() {
  return { bidirectionalMedia: false, streamingWrite: false, clearPlayback: false };
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function playbackInterruptReason(value: unknown): PlaybackInterruptRequest["reason"] | null {
  return value === "barge_in" || value === "session_end" ||
      value === "superseded" || value === "failure"
    ? value
    : null;
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : "";
}
