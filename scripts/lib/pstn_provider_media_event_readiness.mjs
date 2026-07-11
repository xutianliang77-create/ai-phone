import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  closeServer,
  errorMessage,
  listen,
  openPort,
  requestJson,
  startNpmWorkspaceService,
  stopServices,
  waitForHttpService,
} from "./script_service_utils.mjs";

const FRAME_SINK_API_KEY = "local-pstn-frame-sink-secret";
const WEBHOOK_SECRET = "local-pstn-provider-webhook-secret";

export async function checkPstnProviderMediaEventReadiness(options = {}) {
  const config = await buildPstnProviderMediaEventConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.logs.bridge, { force: true });
  const checks = [];
  const issues = [];
  const actions = [];
  const sink = createAudioFrameSink();
  let bridge = null;

  try {
    await listen(sink.server, config.sinkPort);
    bridge = startNpmWorkspaceService({
      root: config.root,
      logPath: config.logs.bridge,
      name: "pstn-provider-media-event",
      script: "dev",
      workspace: "@translation/pstn-bridge",
      env: config.bridgeEnv,
    });
    await waitForHttpService({
      label: "pstn-bridge",
      service: bridge,
      url: `${config.bridgeBaseUrl}/health`,
      timeoutMs: config.timeoutMs,
    });
    await probePstnProviderMediaEvent({
      baseUrl: config.bridgeBaseUrl,
      sink,
      checks,
      issues,
      actions,
      timeoutMs: config.timeoutMs,
      fetchFn: options.fetchFn,
    });
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
    actions.push(`Inspect PSTN Bridge log at ${config.logs.bridge}.`);
  } finally {
    await stopServices([bridge].filter(Boolean));
    await closeServer(sink.server);
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    bridgeBaseUrl: config.bridgeBaseUrl,
    sinkBaseUrl: config.sinkBaseUrl,
    frameSinkCount: sink.frameRequests.length,
    acceptedFrameId: sink.frameRequests[0]?.response?.acceptedFrameId ?? null,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function buildPstnProviderMediaEventConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const bridgePort = Number(options.bridgePort ?? await openPort());
  const sinkPort = Number(options.sinkPort ?? await openPort());
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
  const sinkBaseUrl = `http://127.0.0.1:${sinkPort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/pstn-provider-media-event");
  return {
    root,
    bridgePort,
    sinkPort,
    bridgeBaseUrl,
    sinkBaseUrl,
    cacheDir,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs: { bridge: path.join(cacheDir, "pstn-bridge.log") },
    bridgeEnv: {
      PSTN_BRIDGE_PORT: String(bridgePort),
      PSTN_BRIDGE_PROVIDER: "mock",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: `${sinkBaseUrl}/audio-frames`,
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: FRAME_SINK_API_KEY,
      PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS: "5000",
      PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: WEBHOOK_SECRET,
      PSTN_BRIDGE_PROVIDER_WEBHOOK_MAX_SKEW_MS: "300000",
    },
  };
}

export async function probePstnProviderMediaEvent(options) {
  const health = await requestJson(`${options.baseUrl}/health`, options);
  record(checksOf(options), "pstn_bridge_service_identity", health.status === 200 &&
    health.body?.service === "pstn-bridge", {
    httpStatus: health.status,
    service: health.body?.service,
  });

  const unsigned = await requestJson(`${options.baseUrl}/provider/media-events`, {
    ...options,
    method: "POST",
    allowError: true,
    body: providerMediaEventPayload(),
  });
  record(checksOf(options), "provider_media_event_requires_signature", unsigned.status === 401, {
    httpStatus: unsigned.status,
  });

  const invalidPayload = { ...providerMediaEventPayload(), eventType: "call.started" };
  const invalid = await signedRequest(`${options.baseUrl}/provider/media-events`, invalidPayload, {
    ...options,
    allowError: true,
  });
  record(checksOf(options), "provider_media_event_rejects_invalid_payload", invalid.status === 400, {
    httpStatus: invalid.status,
  });

  const accepted = await signedRequest(
    `${options.baseUrl}/provider/media-events`,
    providerMediaEventPayload(),
    options,
  );
  const acceptedOk = accepted.status === 200 && accepted.body?.status === "accepted";
  record(checksOf(options), "provider_media_event_accepted", acceptedOk, {
    httpStatus: accepted.status,
    status: accepted.body?.status,
    acceptedFrameId: accepted.body?.acceptedFrameId,
  });

  const duplicate = await signedRequest(
    `${options.baseUrl}/provider/media-events`,
    providerMediaEventPayload(),
    options,
  );
  const duplicateOk = duplicate.status === 200 &&
    duplicate.body?.status === "duplicate" &&
    options.sink?.frameRequests?.length === 1;
  record(checksOf(options), "provider_media_event_deduplicates_event_id", duplicateOk, {
    httpStatus: duplicate.status,
    status: duplicate.body?.status,
    frameSinkCount: options.sink?.frameRequests?.length ?? null,
  });

  const sinkRequest = options.sink?.frameRequests?.[0];
  const forwardedOk = sinkRequest?.headers?.authorization === `Bearer ${FRAME_SINK_API_KEY}` &&
    sinkRequest?.body?.callId === "call-provider-media-smoke" &&
    sinkRequest?.body?.mediaStreamId === "stream-provider-media-smoke" &&
    sinkRequest?.body?.sourceSpeakerRole === "guest" &&
    sinkRequest?.body?.audio?.format === "pcm16" &&
    sinkRequest?.body?.audio?.sampleRate === 16000 &&
    typeof sinkRequest?.body?.audio?.data === "string" &&
    sinkRequest.body.audio.data.length > 0;
  record(checksOf(options), "provider_media_event_forwarded_to_audio_sink", forwardedOk, {
    frameSinkCount: options.sink?.frameRequests?.length ?? null,
    authorization: sinkRequest?.headers?.authorization ? "present" : "missing",
    mediaStreamId: sinkRequest?.body?.mediaStreamId,
    sourceSpeakerRole: sinkRequest?.body?.sourceSpeakerRole,
    audioFormat: sinkRequest?.body?.audio?.format,
    sampleRate: sinkRequest?.body?.audio?.sampleRate,
  });

  if (!acceptedOk || !duplicateOk || !forwardedOk) {
    options.issues.push("PSTN provider media event smoke failed.");
    options.actions.push("Check provider webhook secret and PSTN Bridge audio frame sink config.");
  }
}

function createAudioFrameSink() {
  const frameRequests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/audio-frames") {
      const body = await readJson(request);
      const item = {
        headers: { authorization: request.headers.authorization },
        body,
        response: { status: "accepted", acceptedFrameId: `provider-frame-${body.sequence}` },
      };
      frameRequests.push(item);
      sendJson(response, 200, item.response);
      return;
    }
    sendJson(response, 404, { error: { message: "not found" } });
  });
  return { server, frameRequests };
}

async function signedRequest(url, payload, options) {
  const timestamp = Date.now();
  const body = JSON.stringify(payload);
  return requestJson(url, {
    ...options,
    method: "POST",
    body: payload,
    headers: {
      "x-pstn-provider-timestamp": String(timestamp),
      "x-pstn-provider-signature": signBody(body, timestamp),
    },
  });
}

function providerMediaEventPayload() {
  return {
    eventId: "event-provider-media-smoke",
    eventType: "media.frame",
    callId: "call-provider-media-smoke",
    providerCallId: "provider-call-provider-media-smoke",
    mediaStreamId: "stream-provider-media-smoke",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: Date.now(),
    provider: "domestic_bridge",
    audio: { encoding: "mulaw8k", sampleRate: 8000, durationMs: 20, data: "/w==" },
  };
}

function signBody(body, timestamp) {
  return createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function checksOf(options) {
  return options.checks;
}
