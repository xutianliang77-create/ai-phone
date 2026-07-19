import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fromTelephonyMulaw8k } from "./audio-codec.js";
import { buildAudioFrameSink } from "./audio-frame-sink.js";
import { checkReleaseReadiness, loadEnv } from "./config.js";
import { enterpriseMarketingAgentBindingMatches,
  parseEnterpriseMarketingAgentContext } from "./enterprise-agent-call.js";
import { InMemoryProviderEventDeduper, type ProviderEventDeduper } from "./provider-event-deduper.js";
import { handleProviderMediaEvent } from "./provider-media-events.js";
import { handleProviderStatusEvent } from "./provider-status-events.js";
import { buildPstnProvider } from "./providers.js";
import { handlePstnPlaybackControl } from "./pstn-playback-control.js";
import {
  InMemoryPstnDialGate,
  type PstnDialGate,
} from "./pstn-dial-gate.js";
import { buildStatusWebhookSink } from "./status-webhook-sink.js";
import { parseTranslatedAudioRequest } from "./translated-audio-request.js";
import type {
  AgentCallBridgeRequest,
  PstnAudioFrameSink,
  PstnBridgeEnv,
  PstnMediaFrameRequest,
  PstnProvider,
  PstnStatusWebhookSink,
  TtsAudioSinkRequest,
} from "./types.js";

export interface PstnBridgeServerOptions {
  env?: NodeJS.ProcessEnv;
  provider?: PstnProvider;
  audioFrameSink?: PstnAudioFrameSink;
  statusWebhookSink?: PstnStatusWebhookSink;
  providerEventDeduper?: ProviderEventDeduper;
  dialGate?: PstnDialGate;
  fetchFn?: typeof fetch;
}

export function buildPstnBridgeServer(options: PstnBridgeServerOptions = {}) {
  const config = loadEnv(options.env);
  const provider = options.provider ?? buildPstnProvider(config, options.fetchFn);
  const audioFrameSink = options.audioFrameSink ?? buildAudioFrameSink(config, options.fetchFn);
  const statusWebhookSink = options.statusWebhookSink ?? buildStatusWebhookSink(config, options.fetchFn);
  const providerEventDeduper = options.providerEventDeduper ?? new InMemoryProviderEventDeduper();
  const dialGate = options.dialGate ?? new InMemoryPstnDialGate();
  return createServer(async (request, response) => {
    try {
      await handleRequest({
        request,
        response,
        config,
        provider,
        audioFrameSink,
        statusWebhookSink,
        providerEventDeduper,
        dialGate,
        hasAudioFrameSink: Boolean(options.audioFrameSink || config.audioFrameSinkEndpoint),
        hasStatusWebhookSink: Boolean(options.statusWebhookSink ||
          config.statusWebhookEndpoint || config.enterpriseStatusWebhookEndpoint),
      });
    } catch (error) {
      sendJson(response, 500, {
        error: { code: "pstn_bridge_error", message: errorMessage(error) },
      });
    }
  });
}

async function handleRequest(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  provider: PstnProvider;
  audioFrameSink: PstnAudioFrameSink;
  statusWebhookSink: PstnStatusWebhookSink;
  providerEventDeduper: ProviderEventDeduper;
  dialGate: PstnDialGate;
  hasAudioFrameSink: boolean;
  hasStatusWebhookSink: boolean;
}) {
  const { request, response, config, provider } = context;
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "pstn-bridge",
      version: "0.1.0",
      provider: config.provider,
      releaseReady: checkReleaseReadiness(config),
    });
    return;
  }
  if (request.method === "GET" && request.url === "/health/release-ready") {
    const readiness = checkReleaseReadiness(config);
    sendJson(response, readiness.status === "ready" ? 200 : 503, readiness);
    return;
  }
  if (request.method === "POST" && request.url === "/agent-calls") {
    await handleAgentCall({ request, response, config, provider, dialGate: context.dialGate });
    return;
  }
  if (request.method === "POST" && request.url === "/translated-audio") {
    await handleTranslatedAudio({ request, response, config, provider });
    return;
  }
  if (await handlePstnPlaybackControl({ request, response, config, provider })) return;
  if (request.method === "POST" && request.url === "/media-frames") {
    await handleMediaFrame(context);
    return;
  }
  if (request.method === "POST" && request.url === "/provider/media-events") {
    await handleProviderMediaEvent(context);
    return;
  }
  if (request.method === "POST" && request.url === "/provider/status-events") {
    await handleProviderStatusEvent(context);
    return;
  }
  sendJson(response, 404, { error: { code: "not_found", message: "not found" } });
}

async function handleAgentCall(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  provider: PstnProvider;
  dialGate: PstnDialGate;
}) {
  if (!context.config.apiKey) {
    sendError(context.response, 503, "pstn_bridge_not_configured", "PSTN_BRIDGE_API_KEY is required");
    return;
  }
  if (context.request.headers.authorization !== `Bearer ${context.config.apiKey}`) {
    sendError(context.response, 401, "invalid_bridge_api_key", "invalid bridge api key");
    return;
  }
  const body = parseAgentCallRequest(await readJson(context.request));
  if (!body) {
    sendError(context.response, 400, "invalid_agent_call", "invalid agent call payload");
    return;
  }
  if (context.request.headers["idempotency-key"] !== body.idempotencyKey) {
    sendError(context.response, 400, "invalid_idempotency_key", "idempotency key mismatch");
    return;
  }
  const result = await context.dialGate.execute(
    body,
    () => context.provider.placeCall(body),
  );
  sendJson(context.response, 200, { status: result.status ?? "in_progress", ...result });
}

async function handleTranslatedAudio(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  provider: PstnProvider;
}) {
  if (!context.config.apiKey) {
    sendError(context.response, 503, "pstn_bridge_not_configured", "PSTN_BRIDGE_API_KEY is required");
    return;
  }
  if (context.request.headers.authorization !== `Bearer ${context.config.apiKey}`) {
    sendError(context.response, 401, "invalid_bridge_api_key", "invalid bridge api key");
    return;
  }
  const body = parseTranslatedAudioRequest(await readJson(context.request));
  if (!body) {
    sendError(context.response, 400, "invalid_translated_audio", "invalid translated audio payload");
    return;
  }
  const result = await context.provider.playTranslatedAudio(body);
  sendJson(context.response, 200, { status: result.status ?? "queued", ...result });
}

async function handleMediaFrame(context: {
  request: IncomingMessage;
  response: ServerResponse;
  config: PstnBridgeEnv;
  audioFrameSink: PstnAudioFrameSink;
  hasAudioFrameSink: boolean;
}) {
  if (!context.config.apiKey) {
    sendError(context.response, 503, "pstn_bridge_not_configured", "PSTN_BRIDGE_API_KEY is required");
    return;
  }
  if (context.request.headers.authorization !== `Bearer ${context.config.apiKey}`) {
    sendError(context.response, 401, "invalid_bridge_api_key", "invalid bridge api key");
    return;
  }
  if (!context.hasAudioFrameSink) {
    sendError(context.response, 503, "audio_frame_sink_not_configured", "audio frame sink is not configured");
    return;
  }
  const body = parseMediaFrameRequest(await readJson(context.request));
  if (!body) {
    sendError(context.response, 400, "invalid_media_frame", "invalid media frame payload");
    return;
  }
  const result = await context.audioFrameSink.send({
    callId: body.callId,
    providerCallId: body.providerCallId,
    mediaStreamId: body.mediaStreamId,
    sourceSpeakerRole: body.sourceSpeakerRole,
    sequence: body.sequence,
    timestampMs: body.timestampMs,
    provider: body.provider,
    audio: fromTelephonyMulaw8k(body),
  });
  sendJson(context.response, 200, { status: result.status ?? "accepted", ...result });
}

export function parseAgentCallRequest(input: unknown): AgentCallBridgeRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const idempotencyKey = text(body.idempotencyKey, 160);
  const draftId = text(body.draftId, 120);
  const callId = text(body.callId, 120);
  const targetPhone = text(body.targetPhone, 80);
  const objective = text(body.objective, 800);
  const suggestedScript = text(body.suggestedScript, 1200);
  const language = text(body.language, 20);
  const enterpriseContext = parseEnterpriseContext(body.enterpriseContext);
  const enterpriseAgent = parseEnterpriseMarketingAgentContext(body.enterpriseAgent);
  if (!idempotencyKey || !draftId || !callId || !targetPhone || !objective ||
    !suggestedScript || !language ||
    (body.enterpriseContext !== undefined && !enterpriseContext) ||
    (body.enterpriseAgent !== undefined && !enterpriseAgent) ||
    Boolean(enterpriseContext) !== Boolean(enterpriseAgent) ||
    (enterpriseContext && enterpriseAgent &&
      !enterpriseMarketingAgentBindingMatches(enterpriseAgent, enterpriseContext, callId))) {
    return null;
  }
  return {
    idempotencyKey,
    draftId,
    callId,
    targetPhone,
    objective,
    suggestedScript,
    language,
    ...optionalText("targetName", body.targetName, 120),
    ...optionalText("consentPromptVersion", body.consentPromptVersion, 120),
    ...(enterpriseContext ? { enterpriseContext } : {}),
    ...(enterpriseAgent ? { enterpriseAgent } : {}),
  };
}

function parseEnterpriseContext(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype) return null;
  const value = input as Record<string, unknown>;
  const keys = ["tenantId", "homeRegion", "cellId", "routeEpoch", "taskId",
    "dispatchGeneration"];
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) return null;
  const tenantId = text(value.tenantId, 36); const taskId = text(value.taskId, 36);
  const homeRegion = text(value.homeRegion, 64); const cellId = text(value.cellId, 64);
  const routeEpoch = Number(value.routeEpoch); const generation =
    Number(value.dispatchGeneration);
  return uuidText(tenantId) && uuidText(taskId) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(homeRegion) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(cellId) &&
    Number.isSafeInteger(routeEpoch) && routeEpoch > 0 &&
    Number.isSafeInteger(generation) && generation > 0
    ? { tenantId, taskId, homeRegion, cellId, routeEpoch,
      dispatchGeneration: generation } : null;
}

function uuidText(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }

function parseMediaFrameRequest(input: unknown): PstnMediaFrameRequest | null {
  if (!input || typeof input !== "object") return null;
  const body = input as Record<string, unknown>;
  const callId = text(body.callId, 120);
  const mediaStreamId = text(body.mediaStreamId, 160);
  const sourceSpeakerRole = speakerRole(body.sourceSpeakerRole);
  const sequence = Number.isInteger(body.sequence) && Number(body.sequence) >= 0
    ? Number(body.sequence)
    : null;
  const audio = parseTelephonyAudio(body.audio);
  if (!callId || !mediaStreamId || !sourceSpeakerRole || sequence === null || !audio) {
    return null;
  }
  return {
    callId,
    mediaStreamId,
    sourceSpeakerRole,
    sequence,
    audio,
    ...optionalText("providerCallId", body.providerCallId, 160),
    ...optionalText("provider", body.provider, 80),
    ...optionalNumber("timestampMs", body.timestampMs),
  };
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

async function readJson(request: IncomingMessage) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const textBody = Buffer.concat(chunks).toString("utf8");
  return textBody ? JSON.parse(textBody) : null;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, statusCode: number, code: string, message: string) {
  sendJson(response, statusCode, { error: { code, message } });
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

function speakerRole(value: unknown): TtsAudioSinkRequest["sourceSpeakerRole"] | null {
  return value === "host" || value === "guest" ? value : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
