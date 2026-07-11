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

const BRIDGE_API_KEY = "local-pstn-bridge-secret";
const FRAME_SINK_API_KEY = "local-pstn-frame-sink-secret";

export async function checkPstnBridgeMediaIngestReadiness(options = {}) {
  const config = await buildPstnBridgeMediaIngestConfig(options);
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
      name: "pstn-bridge-media-ingest",
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
    await probePstnBridgeMediaIngest({
      baseUrl: config.bridgeBaseUrl,
      bridgeApiKey: BRIDGE_API_KEY,
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

export async function buildPstnBridgeMediaIngestConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const bridgePort = Number(options.bridgePort ?? await openPort());
  const sinkPort = Number(options.sinkPort ?? await openPort());
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
  const sinkBaseUrl = `http://127.0.0.1:${sinkPort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/pstn-bridge-media-ingest");
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
      PSTN_BRIDGE_API_KEY: BRIDGE_API_KEY,
      PSTN_BRIDGE_PROVIDER: "mock",
      PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: `${sinkBaseUrl}/audio-frames`,
      PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: FRAME_SINK_API_KEY,
      PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS: "5000",
    },
  };
}

export async function probePstnBridgeMediaIngest(options) {
  const health = await requestJson(`${options.baseUrl}/health`, options);
  record(checksOf(options), "pstn_bridge_service_identity", health.status === 200 &&
    health.body?.service === "pstn-bridge", {
    httpStatus: health.status,
    service: health.body?.service,
  });

  const unauthorized = await requestJson(`${options.baseUrl}/media-frames`, {
    ...options,
    method: "POST",
    allowError: true,
    body: mediaFramePayload(),
  });
  record(checksOf(options), "media_frame_requires_bridge_key", unauthorized.status === 401, {
    httpStatus: unauthorized.status,
  });

  const invalid = await requestJson(`${options.baseUrl}/media-frames`, {
    ...options,
    method: "POST",
    allowError: true,
    bearerToken: options.bridgeApiKey,
    body: { ...mediaFramePayload(), audio: { encoding: "pcm16", sampleRate: 16000, data: "AA==" } },
  });
  record(checksOf(options), "media_frame_rejects_invalid_payload", invalid.status === 400, {
    httpStatus: invalid.status,
  });

  const accepted = await requestJson(`${options.baseUrl}/media-frames`, {
    ...options,
    method: "POST",
    bearerToken: options.bridgeApiKey,
    body: mediaFramePayload(),
  });
  const acceptedOk = accepted.status === 200 && accepted.body?.status === "accepted";
  record(checksOf(options), "media_frame_accepted", acceptedOk, {
    httpStatus: accepted.status,
    status: accepted.body?.status,
    acceptedFrameId: accepted.body?.acceptedFrameId,
  });

  const sinkRequest = options.sink?.frameRequests?.[0];
  const forwardedOk = sinkRequest?.headers?.authorization === `Bearer ${FRAME_SINK_API_KEY}` &&
    sinkRequest?.body?.callId === "call-media-smoke" &&
    sinkRequest?.body?.mediaStreamId === "stream-media-smoke" &&
    sinkRequest?.body?.sourceSpeakerRole === "guest" &&
    sinkRequest?.body?.audio?.format === "pcm16" &&
    sinkRequest?.body?.audio?.sampleRate === 16000 &&
    typeof sinkRequest?.body?.audio?.data === "string" &&
    sinkRequest.body.audio.data.length > 0;
  record(checksOf(options), "media_frame_forwarded_to_audio_sink", forwardedOk, {
    frameSinkCount: options.sink?.frameRequests?.length ?? null,
    authorization: sinkRequest?.headers?.authorization ? "present" : "missing",
    mediaStreamId: sinkRequest?.body?.mediaStreamId,
    sourceSpeakerRole: sinkRequest?.body?.sourceSpeakerRole,
    audioFormat: sinkRequest?.body?.audio?.format,
    sampleRate: sinkRequest?.body?.audio?.sampleRate,
  });

  if (!acceptedOk || !forwardedOk) {
    options.issues.push("PSTN Bridge media ingest smoke failed.");
    options.actions.push("Check PSTN Bridge /media-frames config and audio frame sink endpoint.");
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
        response: { status: "accepted", acceptedFrameId: `frame-${body.sequence}` },
      };
      frameRequests.push(item);
      sendJson(response, 200, item.response);
      return;
    }
    sendJson(response, 404, { error: { message: "not found" } });
  });
  return { server, frameRequests };
}

function mediaFramePayload() {
  return {
    callId: "call-media-smoke",
    providerCallId: "provider-call-media-smoke",
    mediaStreamId: "stream-media-smoke",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: Date.now(),
    provider: "domestic_bridge",
    audio: { encoding: "mulaw8k", sampleRate: 8000, durationMs: 20, data: "/w==" },
  };
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
