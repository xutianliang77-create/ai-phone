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
const UPSTREAM_API_KEY = "local-pstn-upstream-secret";
const MEDIA_WRITER_API_KEY = "local-pstn-media-writer-secret";

export async function checkPstnBridgeAudioReadiness(options = {}) {
  const config = await buildPstnBridgeAudioReadinessConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.logs.bridge, { force: true });
  const checks = [];
  const issues = [];
  const actions = [];
  const upstream = createPstnAudioUpstream();
  let bridge = null;

  try {
    await listen(upstream.server, config.upstreamPort);
    bridge = startNpmWorkspaceService({
      root: config.root,
      logPath: config.logs.bridge,
      name: "pstn-bridge-audio",
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
    await probePstnBridgeTranslatedAudio({
      baseUrl: config.bridgeBaseUrl,
      bridgeApiKey: BRIDGE_API_KEY,
      upstream,
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
    await closeServer(upstream.server);
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    bridgeBaseUrl: config.bridgeBaseUrl,
    upstreamBaseUrl: config.upstreamBaseUrl,
    upstreamCallCount: upstream.callRequests.length,
    upstreamAudioCount: upstream.audioRequests.length,
    mediaWriteCount: upstream.mediaWriteRequests.length,
    providerPlaybackId: upstream.audioRequests[0]?.response?.providerPlaybackId ?? null,
    mediaWriteId: upstream.mediaWriteRequests[0]?.response?.mediaWriteId ?? null,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function buildPstnBridgeAudioReadinessConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const bridgePort = Number(options.bridgePort ?? await openPort());
  const upstreamPort = Number(options.upstreamPort ?? await openPort());
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
  const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/pstn-bridge-audio-readiness");
  return {
    root,
    bridgePort,
    upstreamPort,
    bridgeBaseUrl,
    upstreamBaseUrl,
    cacheDir,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs: {
      bridge: path.join(cacheDir, "pstn-bridge.log"),
    },
    bridgeEnv: {
      PSTN_BRIDGE_PORT: String(bridgePort),
      PSTN_BRIDGE_API_KEY: BRIDGE_API_KEY,
      PSTN_BRIDGE_PROVIDER: "http",
      PSTN_BRIDGE_UPSTREAM_BASE_URL: upstreamBaseUrl,
      PSTN_BRIDGE_UPSTREAM_API_KEY: UPSTREAM_API_KEY,
      PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS: "5000",
      PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: `${upstreamBaseUrl}/media/write`,
      PSTN_BRIDGE_MEDIA_WRITER_API_KEY: MEDIA_WRITER_API_KEY,
      PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS: "5000",
      PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
    },
  };
}

export async function probePstnBridgeTranslatedAudio(options) {
  const health = await requestJson(`${options.baseUrl}/health`, options);
  record(checksOf(options), "pstn_bridge_service_identity", health.status === 200 &&
    health.body?.service === "pstn-bridge", {
    httpStatus: health.status,
    service: health.body?.service,
    provider: health.body?.provider,
  });

  const unauthorized = await requestJson(`${options.baseUrl}/translated-audio`, {
    ...options,
    method: "POST",
    allowError: true,
    body: translatedAudioPayload(),
  });
  record(checksOf(options), "translated_audio_requires_bridge_key", unauthorized.status === 401, {
    httpStatus: unauthorized.status,
  });

  const invalid = await requestJson(`${options.baseUrl}/translated-audio`, {
    ...options,
    method: "POST",
    allowError: true,
    bearerToken: options.bridgeApiKey,
    body: { ...translatedAudioPayload(), targetSpeakerRole: "host" },
  });
  record(checksOf(options), "translated_audio_rejects_invalid_payload", invalid.status === 400, {
    httpStatus: invalid.status,
  });

  const callPayload = agentCallPayload();
  const route = await requestJson(`${options.baseUrl}/agent-calls`, {
    ...options,
    method: "POST",
    bearerToken: options.bridgeApiKey,
    headers: { "idempotency-key": callPayload.idempotencyKey },
    body: callPayload,
  });
  const routeOk = route.status === 200 &&
    route.body?.providerCallId === "upstream-call-audio-smoke" &&
    route.body?.mediaStreamId === "upstream-stream-audio-smoke";
  record(checksOf(options), "pstn_bridge_call_route_created", routeOk, {
    httpStatus: route.status,
    providerCallId: route.body?.providerCallId,
    mediaStreamId: route.body?.mediaStreamId,
  });

  const accepted = await requestJson(`${options.baseUrl}/translated-audio`, {
    ...options,
    method: "POST",
    bearerToken: options.bridgeApiKey,
    body: translatedAudioPayload(),
  });
  const acceptedOk = accepted.status === 200 && accepted.body?.status === "played";
  record(checksOf(options), "translated_audio_accepted", acceptedOk, {
    httpStatus: accepted.status,
    status: accepted.body?.status,
    providerPlaybackId: accepted.body?.providerPlaybackId,
  });

  const upstreamRequest = options.upstream?.audioRequests?.[0];
  const forwardedOk = upstreamRequest?.headers?.authorization === `Bearer ${UPSTREAM_API_KEY}` &&
    upstreamRequest?.body?.callId === "call-audio-smoke" &&
    upstreamRequest?.body?.providerCallId === "upstream-call-audio-smoke" &&
    upstreamRequest?.body?.mediaStreamId === "upstream-stream-audio-smoke" &&
    upstreamRequest?.body?.targetSpeakerRole === "guest" &&
    upstreamRequest?.body?.audio?.format === "pcm16" &&
    upstreamRequest?.body?.telephonyAudio?.encoding === "mulaw8k" &&
    upstreamRequest?.body?.telephonyAudio?.sampleRate === 8000 &&
    typeof upstreamRequest?.body?.telephonyAudio?.data === "string" &&
    upstreamRequest.body.telephonyAudio.data.length > 0;
  record(checksOf(options), "translated_audio_forwarded_to_upstream", forwardedOk, {
    audioRequestCount: options.upstream?.audioRequests?.length ?? null,
    authorization: upstreamRequest?.headers?.authorization ? "present" : "missing",
    providerCallId: upstreamRequest?.body?.providerCallId,
    mediaStreamId: upstreamRequest?.body?.mediaStreamId,
    targetSpeakerRole: upstreamRequest?.body?.targetSpeakerRole,
    sampleRate: upstreamRequest?.body?.audio?.sampleRate,
    telephonyEncoding: upstreamRequest?.body?.telephonyAudio?.encoding,
    telephonySampleRate: upstreamRequest?.body?.telephonyAudio?.sampleRate,
    telephonyPayloadBytes: upstreamRequest?.body?.telephonyAudio?.data
      ? Buffer.from(upstreamRequest.body.telephonyAudio.data, "base64").length
      : 0,
  });

  const mediaWrite = options.upstream?.mediaWriteRequests?.[0];
  const mediaWrittenOk = mediaWrite?.headers?.authorization === `Bearer ${MEDIA_WRITER_API_KEY}` &&
    mediaWrite?.body?.callId === "call-audio-smoke" &&
    mediaWrite?.body?.providerCallId === "upstream-call-audio-smoke" &&
    mediaWrite?.body?.mediaStreamId === "upstream-stream-audio-smoke" &&
    mediaWrite?.body?.targetSpeakerRole === "guest" &&
    mediaWrite?.body?.telephonyAudio?.encoding === "mulaw8k" &&
    mediaWrite?.body?.telephonyAudio?.sampleRate === 8000 &&
    typeof mediaWrite?.body?.telephonyAudio?.data === "string" &&
    mediaWrite.body.telephonyAudio.data.length > 0;
  record(checksOf(options), "translated_audio_written_to_media", mediaWrittenOk, {
    mediaWriteCount: options.upstream?.mediaWriteRequests?.length ?? null,
    authorization: mediaWrite?.headers?.authorization ? "present" : "missing",
    providerCallId: mediaWrite?.body?.providerCallId,
    mediaStreamId: mediaWrite?.body?.mediaStreamId,
    targetSpeakerRole: mediaWrite?.body?.targetSpeakerRole,
    telephonyEncoding: mediaWrite?.body?.telephonyAudio?.encoding,
    telephonySampleRate: mediaWrite?.body?.telephonyAudio?.sampleRate,
  });

  if (!acceptedOk || !forwardedOk || !mediaWrittenOk) {
    options.issues.push("PSTN Bridge translated audio playback smoke failed.");
    options.actions.push("Check PSTN Bridge /translated-audio config and media writer endpoint.");
  }
}

function createPstnAudioUpstream() {
  const callRequests = [];
  const audioRequests = [];
  const mediaWriteRequests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/agent-calls") {
      const body = await readJson(request);
      const item = {
        headers: { authorization: request.headers.authorization },
        body,
        response: {
          status: "in_progress",
          providerCallId: "upstream-call-audio-smoke",
          mediaStreamId: "upstream-stream-audio-smoke",
        },
      };
      callRequests.push(item);
      sendJson(response, 200, item.response);
      return;
    }
    if (request.method === "POST" && request.url === "/translated-audio") {
      const body = await readJson(request);
      const item = {
        headers: { authorization: request.headers.authorization },
        body,
        response: { status: "played", providerPlaybackId: `upstream-playback-${body.segmentId}` },
      };
      audioRequests.push(item);
      sendJson(response, 200, item.response);
      return;
    }
    if (request.method === "POST" && request.url === "/media/write") {
      const body = await readJson(request);
      const item = {
        headers: { authorization: request.headers.authorization },
        body,
        response: { mediaWriteId: `media-write-${body.segmentId}` },
      };
      mediaWriteRequests.push(item);
      sendJson(response, 200, item.response);
      return;
    }
    sendJson(response, 404, { error: { message: "not found" } });
  });
  return { server, callRequests, audioRequests, mediaWriteRequests };
}

function agentCallPayload() {
  return {
    idempotencyKey: "agent-call:call-audio-smoke",
    draftId: "draft-audio-smoke",
    callId: "call-audio-smoke",
    targetPhone: "+8613800138000",
    objective: "验证电话译音回灌",
    suggestedScript: "您好，这是电话译音回灌测试。",
    language: "zh",
    consentPromptVersion: "cn-agent-v1",
  };
}

function translatedAudioPayload() {
  return {
    callId: "call-audio-smoke",
    sessionId: "call-audio-smoke",
    segmentId: "seg-audio-smoke",
    playbackId: "playback-audio-smoke",
    generation: 1,
    sourceLegId: "leg-host-audio-smoke",
    targetLegId: "leg-guest-audio-smoke",
    sourceSpeakerRole: "host",
    targetSpeakerRole: "guest",
    language: "en",
    provider: "qwen3-tts",
    model: "qwen3-tts-0.6b",
    firstAudioMs: 320,
    audioDurationMs: 640,
    audio: { format: "pcm16", sampleRate: 16000, data: Buffer.alloc(8).toString("base64") },
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
