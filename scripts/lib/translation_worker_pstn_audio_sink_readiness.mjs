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

const AUDIO_SINK_KEY = "local-translation-worker-frame-sink-secret";
const INTERNAL_SECRET = "local-translation-worker-internal-secret";

export async function checkTranslationWorkerPstnAudioSinkReadiness(options = {}) {
  const config = await buildTranslationWorkerPstnAudioSinkConfig(options);
  mkdirSync(config.cacheDir, { recursive: true });
  rmSync(config.logs.worker, { force: true });
  const checks = [];
  const issues = [];
  const actions = [];
  const mock = createMockProviderServer();
  let worker = null;

  try {
    await listen(mock.server, config.mockPort);
    worker = startNpmWorkspaceService({
      root: config.root,
      logPath: config.logs.worker,
      name: "translation-worker-pstn-audio-sink",
      script: "dev:pstn-audio-sink",
      workspace: "@translation/translation-worker",
      env: config.workerEnv,
    });
    await waitForHttpService({
      label: "translation-worker-pstn-audio-sink",
      service: worker,
      url: `${config.workerBaseUrl}/health`,
      timeoutMs: config.timeoutMs,
    });
    await probeTranslationWorkerPstnAudioSink({
      baseUrl: config.workerBaseUrl,
      audioSinkKey: AUDIO_SINK_KEY,
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
    actions.push(`Inspect Translation Worker PSTN audio sink log at ${config.logs.worker}.`);
  } finally {
    await stopServices([worker].filter(Boolean));
    await closeServer(mock.server);
  }

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    workerBaseUrl: config.workerBaseUrl,
    mockBaseUrl: config.mockBaseUrl,
    asrFrameCount: mock.asrRequests.length,
    eventBatchCount: mock.eventRequests.length,
    playbackCount: mock.playbackRequests.length,
    logs: config.logs,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

export async function buildTranslationWorkerPstnAudioSinkConfig(options = {}) {
  const root = options.root ?? process.cwd();
  const workerPort = Number(options.workerPort ?? await openPort());
  const mockPort = Number(options.mockPort ?? await openPort());
  const workerBaseUrl = `http://127.0.0.1:${workerPort}`;
  const mockBaseUrl = `http://127.0.0.1:${mockPort}`;
  const cacheDir = options.cacheDir ?? path.join(root, ".cache/translation-worker-pstn-audio-sink");
  return {
    root,
    workerPort,
    mockPort,
    workerBaseUrl,
    mockBaseUrl,
    cacheDir,
    timeoutMs: Number(options.timeoutMs ?? 60000),
    logs: { worker: path.join(cacheDir, "translation-worker-pstn-audio-sink.log") },
    workerEnv: {
      TRANSLATION_WORKER_AUDIO_FRAME_SINK_PORT: String(workerPort),
      TRANSLATION_WORKER_AUDIO_FRAME_SINK_API_KEY: AUDIO_SINK_KEY,
      API_BASE_URL: mockBaseUrl,
      INTERNAL_API_SECRET: INTERNAL_SECRET,
      ASR_HTTP_ENDPOINT: `${mockBaseUrl}/asr/transcribe`,
      ASR_HTTP_FLUSH_ENDPOINT: `${mockBaseUrl}/asr/sessions/:sessionId/flush`,
      ASR_HTTP_TIMEOUT_MS: "5000",
      LMSTUDIO_BASE_URL: `${mockBaseUrl}/v1`,
      LMSTUDIO_MODEL: "mock-call-translation",
      LMSTUDIO_TIMEOUT_MS: "5000",
      TTS_HTTP_ENDPOINT: `${mockBaseUrl}/tts/synthesize`,
      TTS_HTTP_TIMEOUT_MS: "5000",
      TTS_AUDIO_SINK_ENDPOINT: `${mockBaseUrl}/tts/play`,
      TTS_AUDIO_SINK_TIMEOUT_MS: "5000",
    },
  };
}

export async function probeTranslationWorkerPstnAudioSink(options) {
  const health = await requestJson(`${options.baseUrl}/health`, options);
  record(options.checks, "pstn_audio_sink_service_identity", health.status === 200 &&
    health.body?.service === "translation-worker-pstn-audio-frame-sink", {
    httpStatus: health.status,
    service: health.body?.service,
  });

  const unauthorized = await requestJson(`${options.baseUrl}/pstn/audio-frames`, {
    ...options,
    method: "POST",
    allowError: true,
    body: audioFramePayload(),
  });
  record(options.checks, "pstn_audio_frame_requires_key", unauthorized.status === 401, {
    httpStatus: unauthorized.status,
  });

  const invalid = await requestJson(`${options.baseUrl}/pstn/audio-frames`, {
    ...options,
    method: "POST",
    allowError: true,
    bearerToken: options.audioSinkKey,
    body: { ...audioFramePayload(), audio: { format: "pcm16", sampleRate: 24000, data: "AA==" } },
  });
  record(options.checks, "pstn_audio_frame_rejects_invalid_payload", invalid.status === 400, {
    httpStatus: invalid.status,
  });

  const accepted = await requestJson(`${options.baseUrl}/pstn/audio-frames`, {
    ...options,
    method: "POST",
    bearerToken: options.audioSinkKey,
    body: audioFramePayload(),
  });
  record(options.checks, "pstn_audio_frame_accepted", accepted.status === 200 &&
    accepted.body?.status === "accepted", {
    httpStatus: accepted.status,
    status: accepted.body?.status,
    acceptedFrameId: accepted.body?.acceptedFrameId,
  });

  const duplicate = await requestJson(`${options.baseUrl}/pstn/audio-frames`, {
    ...options,
    method: "POST",
    bearerToken: options.audioSinkKey,
    body: audioFramePayload(),
  });
  record(options.checks, "pstn_audio_duplicate_dropped", duplicate.body?.status === "dropped", {
    status: duplicate.body?.status,
  });

  recordEndToEndChecks(options);
  if (options.checks.some((check) => check.status === "fail")) {
    options.issues.push("Translation Worker PSTN audio sink smoke failed.");
    options.actions.push("Check ASR, translation, TTS, event API, and TTS audio sink wiring.");
  }
}

function recordEndToEndChecks(options) {
  const asrRequest = options.mock.asrRequests[0];
  record(options.checks, "pstn_audio_reached_asr", asrRequest?.body?.audio === undefined &&
    asrRequest?.body?.format === "pcm16" &&
    asrRequest?.body?.sampleRate === 16000 &&
    asrRequest?.body?.sessionId === "call-pstn-smoke:guest", {
    asrFrameCount: options.mock.asrRequests.length,
    sessionId: asrRequest?.body?.sessionId,
    sampleRate: asrRequest?.body?.sampleRate,
  });

  record(options.checks, "pstn_audio_translation_called", options.mock.translationRequests.length === 1, {
    translationCount: options.mock.translationRequests.length,
  });

  const events = options.mock.eventRequests.flatMap((request) => request.body?.events ?? []);
  record(options.checks, "pstn_audio_events_published", events.some((event) =>
    event.type === "translation.final" && event.translatedText === "电话来音已翻译"
  ), {
    eventBatchCount: options.mock.eventRequests.length,
    eventTypes: events.map((event) => event.type),
  });

  const playback = options.mock.playbackRequests[0]?.body;
  record(options.checks, "pstn_audio_tts_playback_sent", playback?.callId === "call-pstn-smoke" &&
    playback?.targetSpeakerRole === "host" &&
    playback?.audio?.format === "pcm16", {
    playbackCount: options.mock.playbackRequests.length,
    targetSpeakerRole: playback?.targetSpeakerRole,
    audioFormat: playback?.audio?.format,
  });
}

function createMockProviderServer() {
  const asrRequests = [];
  const translationRequests = [];
  const ttsRequests = [];
  const playbackRequests = [];
  const eventRequests = [];
  const flushRequests = [];
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/asr/transcribe") {
      asrRequests.push({ body });
      sendJson(response, 200, {
        segmentId: "seg-pstn-smoke",
        text: "hello from phone",
        language: "en",
        confidence: 0.99,
      });
      return;
    }
    if (request.method === "POST" && request.url?.startsWith("/asr/sessions/")) {
      flushRequests.push({ body, url: request.url });
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      translationRequests.push({ body });
      sendJson(response, 200, { choices: [{ message: { content: "电话来音已翻译" } }] });
      return;
    }
    if (request.method === "POST" && request.url === "/tts/synthesize") {
      ttsRequests.push({ body });
      sendJson(response, 200, {
        provider: "mock-tts",
        model: "mock-phone-voice",
        firstAudioMs: 20,
        audioDurationMs: 200,
        audio: { format: "pcm16", sampleRate: 16000, data: "AA==" },
      });
      return;
    }
    if (request.method === "POST" && request.url === "/tts/play") {
      playbackRequests.push({ body });
      sendJson(response, 200, { status: "queued" });
      return;
    }
    if (request.method === "POST" && request.url === "/internal/call-links/call-pstn-smoke/events") {
      eventRequests.push({ body, authorization: request.headers.authorization });
      sendJson(response, 200, { status: "ok" });
      return;
    }
    sendJson(response, 404, { error: { message: `unexpected ${request.method} ${request.url}` } });
  });
  return { server, asrRequests, translationRequests, ttsRequests, playbackRequests, eventRequests, flushRequests };
}

function audioFramePayload() {
  return {
    callId: "call-pstn-smoke",
    mediaStreamId: "stream-pstn-smoke",
    sourceSpeakerRole: "guest",
    sequence: 1,
    timestampMs: Date.now(),
    audio: { format: "pcm16", sampleRate: 16000, data: "AA==" },
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
