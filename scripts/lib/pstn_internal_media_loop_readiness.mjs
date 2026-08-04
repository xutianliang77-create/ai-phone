import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  closeServer,
  errorMessage,
  listen,
  openPort,
  requestJson,
  sleep,
  startNpmWorkspaceService,
  stopServices,
  waitForHttpService,
} from "./script_service_utils.mjs";
import {
  agentCallPayload,
  createLoopMockServer,
  mediaFramePayload,
} from "./pstn_internal_media_loop_mock.mjs";

const BRIDGE_API_KEY = "local-pstn-loop-bridge-secret";
const FRAME_SINK_API_KEY = "local-pstn-loop-frame-sink-secret";
const UPSTREAM_API_KEY = "local-pstn-loop-upstream-secret";
const MEDIA_WRITER_API_KEY = "local-pstn-loop-media-writer-secret";
const INTERNAL_SECRET = "local-pstn-loop-internal-secret";

export async function checkPstnInternalMediaLoopReadiness(options = {}) {
  const config = await buildPstnInternalMediaLoopConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.logs.bridge, { force: true });
  rmSync(config.logs.worker, { force: true });
  const checks = [];
  const issues = [];
  const actions = [];
  const mock = createLoopMockServer();
  let bridge = null;
  let worker = null;

  try {
    await listen(mock.server, config.mockPort);
    bridge = startService(config, "pstn-bridge-loop", "dev", "@translation/pstn-bridge", config.bridgeEnv);
    worker = startService(
      config,
      "translation-worker-pstn-loop",
      "dev:pstn-audio-sink",
      "@translation/translation-worker",
      config.workerEnv,
    );
    await waitForHttpService({
      label: "pstn-bridge",
      service: bridge,
      url: `${config.bridgeBaseUrl}/health`,
      timeoutMs: config.timeoutMs,
    });
    await waitForHttpService({
      label: "translation-worker-pstn-audio-sink",
      service: worker,
      url: `${config.workerBaseUrl}/health`,
      timeoutMs: config.timeoutMs,
    });
    await probePstnInternalMediaLoop({
      bridgeBaseUrl: config.bridgeBaseUrl,
      workerBaseUrl: config.workerBaseUrl,
      bridgeApiKey: BRIDGE_API_KEY,
      mock,
      checks,
      issues,
      actions,
      timeoutMs: config.timeoutMs,
      fetchFn: options.fetchFn,
    });
  } catch (error) {
    issues.push(errorMessage(error));
    record(checks, "unexpected_error", false, { message: errorMessage(error) });
    actions.push(`Inspect logs at ${config.logs.bridge} and ${config.logs.worker}.`);
  } finally {
    await stopServices([bridge, worker].filter(Boolean));
    await closeServer(mock.server);
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    bridgeBaseUrl: config.bridgeBaseUrl,
    workerBaseUrl: config.workerBaseUrl,
    mockBaseUrl: config.mockBaseUrl,
    asrFrameCount: mock.asrRequests.length,
    eventBatchCount: mock.eventRequests.length,
    upstreamAudioCount: mock.audioRequests.length,
    mediaWriteCount: mock.mediaWriteRequests.length,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function buildPstnInternalMediaLoopConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const bridgePort = Number(options.bridgePort ?? await openPort());
  const workerPort = Number(options.workerPort ?? await openPort());
  const mockPort = Number(options.mockPort ?? await openPort());
  const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/pstn-internal-media-loop");
  return {
    root,
    bridgePort,
    workerPort,
    mockPort,
    bridgeBaseUrl,
    workerBaseUrl,
    mockBaseUrl,
    cacheDir,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs: {
      bridge: path.join(cacheDir, "pstn-bridge.log"),
      worker: path.join(cacheDir, "translation-worker-pstn-audio-sink.log"),
    },
    bridgeEnv: bridgeEnv(bridgePort, mockBaseUrl, workerBaseUrl),
    workerEnv: workerEnv(workerPort, mockBaseUrl, bridgeBaseUrl),
  };
}

export async function probePstnInternalMediaLoop(options) {
  await recordServiceIdentities(options);

  const callPayload = agentCallPayload();
  const route = await requestJson(`${options.bridgeBaseUrl}/agent-calls`, {
    ...options,
    method: "POST",
    bearerToken: options.bridgeApiKey,
    headers: { "idempotency-key": callPayload.idempotencyKey },
    body: callPayload,
  });
  const routeOk = route.status === 200 &&
    route.body?.providerCallId === "upstream-call-loop" &&
    route.body?.mediaStreamId === "upstream-stream-loop";
  record(options.checks, "loop_call_route_created", routeOk, {
    httpStatus: route.status,
    providerCallId: route.body?.providerCallId,
    mediaStreamId: route.body?.mediaStreamId,
  });

  const accepted = await requestJson(`${options.bridgeBaseUrl}/media-frames`, {
    ...options,
    method: "POST",
    bearerToken: options.bridgeApiKey,
    body: mediaFramePayload(),
  });
  record(options.checks, "loop_media_frame_accepted", accepted.status === 200 &&
    accepted.body?.status === "accepted", {
    httpStatus: accepted.status,
    status: accepted.body?.status,
    acceptedFrameId: accepted.body?.acceptedFrameId,
  });

  await waitForLoopEffects(options);
  recordLoopEffects(options);
  if (options.checks.some((check) => check.status === "fail")) {
    options.issues.push("PSTN internal media loop smoke failed.");
    options.actions.push("Check PSTN Bridge -> Translation Worker -> TTS -> media writer wiring.");
  }
}

async function waitForLoopEffects(options) {
  const timeoutMs = Number(options.settleTimeoutMs ??
    Math.min(options.timeoutMs ?? 5_000, 5_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = options.mock.eventRequests
      .flatMap((request) => request.body?.events ?? []);
    if (options.mock.asrRequests.length > 0 &&
      events.some((event) => event.type === "translation.final") &&
      options.mock.audioRequests.length > 0 &&
      options.mock.mediaWriteRequests.length > 0) {
      return;
    }
    await sleep(25);
  }
}

function startService(config, name, script, workspace, env) {
  return startNpmWorkspaceService({
    root: config.root,
    logPath: name.includes("bridge") ? config.logs.bridge : config.logs.worker,
    name,
    script,
    workspace,
    env,
  });
}

async function recordServiceIdentities(options) {
  const bridgeHealth = await requestJson(`${options.bridgeBaseUrl}/health`, options);
  record(options.checks, "loop_pstn_bridge_identity", bridgeHealth.status === 200 &&
    bridgeHealth.body?.service === "pstn-bridge", {
    httpStatus: bridgeHealth.status,
    service: bridgeHealth.body?.service,
  });
  const workerHealth = await requestJson(`${options.workerBaseUrl}/health`, options);
  record(options.checks, "loop_worker_audio_sink_identity", workerHealth.status === 200 &&
    workerHealth.body?.service === "translation-worker-pstn-audio-frame-sink", {
    httpStatus: workerHealth.status,
    service: workerHealth.body?.service,
  });
}

function recordLoopEffects(options) {
  const asrRequest = options.mock.asrRequests[0];
  record(options.checks, "loop_frame_reached_worker_asr", asrRequest?.body?.sessionId === "call-loop:guest" &&
    asrRequest?.body?.format === "pcm16" && asrRequest?.body?.sampleRate === 16000, {
    asrFrameCount: options.mock.asrRequests.length,
    sessionId: asrRequest?.body?.sessionId,
    sampleRate: asrRequest?.body?.sampleRate,
  });
  const events = options.mock.eventRequests.flatMap((request) => request.body?.events ?? []);
  record(options.checks, "loop_caption_events_published", events.some((event) =>
    event.type === "translation.final" && event.translatedText === "内部媒体闭环已翻译"
  ), {
    eventBatchCount: options.mock.eventRequests.length,
    eventTypes: events.map((event) => event.type),
    workerStatuses: events
      .filter((event) => event.type === "worker.status")
      .map((event) => ({ segmentId: event.segmentId, text: event.text, stage: event.stage })),
  });

  const audio = options.mock.audioRequests[0];
  record(options.checks, "loop_tts_returned_to_bridge_upstream", audio?.body?.callId === "call-loop" &&
    audio?.body?.providerCallId === "upstream-call-loop" &&
    audio?.body?.mediaStreamId === "upstream-stream-loop" &&
    audio?.body?.targetSpeakerRole === "host" &&
    audio?.body?.telephonyAudio?.encoding === "mulaw8k", {
    upstreamAudioCount: options.mock.audioRequests.length,
    providerCallId: audio?.body?.providerCallId,
    mediaStreamId: audio?.body?.mediaStreamId,
    targetSpeakerRole: audio?.body?.targetSpeakerRole,
    telephonyEncoding: audio?.body?.telephonyAudio?.encoding,
  });

  const write = options.mock.mediaWriteRequests[0];
  record(options.checks, "loop_tts_written_to_media", write?.body?.callId === "call-loop" &&
    write?.body?.mediaStreamId === "upstream-stream-loop" &&
    write?.body?.targetSpeakerRole === "host" &&
    write?.body?.telephonyAudio?.sampleRate === 8000, {
    mediaWriteCount: options.mock.mediaWriteRequests.length,
    mediaStreamId: write?.body?.mediaStreamId,
    targetSpeakerRole: write?.body?.targetSpeakerRole,
    telephonySampleRate: write?.body?.telephonyAudio?.sampleRate,
  });
}

function bridgeEnv(port, mockBaseUrl, workerBaseUrl) {
  return {
    PSTN_BRIDGE_PORT: String(port),
    PSTN_BRIDGE_API_KEY: BRIDGE_API_KEY,
    PSTN_BRIDGE_PROVIDER: "http",
    PSTN_BRIDGE_UPSTREAM_BASE_URL: mockBaseUrl,
    PSTN_BRIDGE_UPSTREAM_API_KEY: UPSTREAM_API_KEY,
    PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS: "5000",
    PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT: `${mockBaseUrl}/media/write`,
    PSTN_BRIDGE_MEDIA_WRITER_API_KEY: MEDIA_WRITER_API_KEY,
    PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS: "5000",
    PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT: `${workerBaseUrl}/pstn/audio-frames`,
    PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: FRAME_SINK_API_KEY,
    PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS: "5000",
    PSTN_RECORDING_DISCLOSURE_ENABLED: "true",
  };
}

function workerEnv(port, mockBaseUrl, bridgeBaseUrl) {
  return {
    TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT: String(port),
    TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY: FRAME_SINK_API_KEY,
    API_BASE_URL: mockBaseUrl,
    INTERNAL_API_SECRET: INTERNAL_SECRET,
    ASR_HTTP_ENDPOINT: `${mockBaseUrl}/asr/transcribe`,
    ASR_HTTP_TIMEOUT_MS: "5000",
    LMSTUDIO_BASE_URL: `${mockBaseUrl}/v1`,
    LMSTUDIO_MODEL: "mock-call-translation",
    LMSTUDIO_TIMEOUT_MS: "5000",
    TTS_HTTP_ENDPOINT: `${mockBaseUrl}/tts/synthesize`,
    TTS_HTTP_TIMEOUT_MS: "5000",
    TTS_PROVIDER: "mock-tts",
    TTS_MODEL: "mock-phone-voice",
    TTS_AUDIO_SINK_ENDPOINT: `${bridgeBaseUrl}/translated-audio`,
    TTS_AUDIO_SINK_API_KEY: BRIDGE_API_KEY,
    TTS_AUDIO_SINK_TIMEOUT_MS: "5000",
  };
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
