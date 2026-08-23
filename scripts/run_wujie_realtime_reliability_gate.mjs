import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";
import { readPcm16MonoWav } from "./lib/realtime_speaker_turn_readiness.mjs";

export function percentile(values, ratio) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)];
}

export function summarizeTailResults(results) {
  const passed = results.filter((result) => result.ok).length;
  const required = Math.ceil(results.length * 0.99);
  const latencies = results.filter((result) => Number.isFinite(result.endLatencyMs))
    .map((result) => result.endLatencyMs);
  return {
    ok: passed >= required,
    iterations: results.length,
    passed,
    failed: results.length - passed,
    required,
    successRate: results.length > 0 ? passed / results.length : 0,
    endLatencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length > 0 ? Math.max(...latencies) : null,
    },
  };
}

export function evaluateLongResult(result, options) {
  const translated = result.segments.filter((segment) => segment.translatedText?.trim()).length;
  const coverage = result.segments.length > 0 ? translated / result.segments.length : 0;
  const errors = [
    ...(result.wallDurationMs < options.minimumWallDurationMs
      ? [`wall duration ${result.wallDurationMs}ms is below ${options.minimumWallDurationMs}ms`] : []),
    ...(result.segments.length < options.minimumSegments
      ? [`segment count ${result.segments.length} is below ${options.minimumSegments}`] : []),
    ...(coverage < options.minimumTranslationCoverage
      ? [`translation coverage ${coverage} is below ${options.minimumTranslationCoverage}`] : []),
    ...(result.droppedFrameCount !== 0
      ? [`dropped frame count is ${result.droppedFrameCount}`] : []),
    ...(result.eventErrors.length > 0 ? ["realtime error events were emitted"] : []),
  ];
  return { ok: errors.length === 0, errors, translationCoverage: coverage };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function createSession(config) {
  const response = await fetch(`${config.apiBaseUrl}/realtime/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: config.sessionMode,
      sourceLanguage: config.sourceLanguage,
      targetLanguage: config.targetLanguage,
      autoReverseTargetLanguage: true,
      voiceOutput: false,
      speakerAttribution: { mode: "off", maxSpeakers: 4, allowVoiceIdentity: false },
    }),
  });
  if (!response.ok) throw new Error(`session create failed: HTTP ${response.status}`);
  return response.json();
}

async function streamSession(session, fixture, config) {
  const events = [];
  const timeline = [];
  const started = deferred();
  const ended = deferred();
  const socket = new WebSocket(session.endpoint, [
    "ai-phone.realtime.v1",
    `ai-phone.token.${session.realtimeToken}`,
  ]);
  socket.on("message", (data) => {
    const event = JSON.parse(data.toString());
    events.push(event);
    timeline.push({ type: event.type, segmentId: event.segmentId, observedAtMs: Date.now() });
    if (event.type === "session.started") started.resolve(event);
    if (event.type === "session.ended") ended.resolve(event);
    if (event.type === "error") ended.reject(new Error(`${event.code}: ${event.message}`));
  });
  socket.on("error", (error) => {
    started.reject(error);
    ended.reject(error);
  });
  await withTimeout(started.promise, config.sessionTimeoutMs, "session start");

  const bytesPerFrame = Math.round(fixture.sampleRate * 2 * config.frameMs / 1000);
  const streamStartedAtMs = Date.now();
  let sequence = 0;
  let audioElapsedMs = 0;
  let lastProgressAtMs = streamStartedAtMs;
  for (let repeat = 0; repeat < config.repeats; repeat += 1) {
    for (let offset = 0; offset < fixture.pcm.length; offset += bytesPerFrame) {
      const data = fixture.pcm.subarray(offset, offset + bytesPerFrame);
      socket.send(JSON.stringify({
        type: "audio.frame",
        sessionId: session.sessionId,
        sequence: ++sequence,
        timestampMs: streamStartedAtMs + audioElapsedMs,
        format: "pcm16",
        sampleRate: fixture.sampleRate,
        data: data.toString("base64"),
      }));
      const frameDurationMs = Math.round(data.length / 2 / fixture.sampleRate * 1000);
      audioElapsedMs += frameDurationMs;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, frameDurationMs));
      if (Date.now() - lastProgressAtMs >= config.progressIntervalMs) {
        lastProgressAtMs = Date.now();
        console.log(JSON.stringify({
          progress: true,
          sessionId: session.sessionId,
          repeat: repeat + 1,
          repeats: config.repeats,
          sequence,
          audioElapsedMs,
        }));
      }
    }
  }
  const endSentAtMs = Date.now();
  socket.send(JSON.stringify({ type: "session.end", sessionId: session.sessionId }));
  const endedEvent = await withTimeout(ended.promise, config.sessionTimeoutMs, "session end");
  const endedAtMs = Date.now();
  socket.close();
  return {
    events,
    timeline,
    endedEvent,
    sequence,
    audioElapsedMs,
    streamStartedAtMs,
    endSentAtMs,
    endedAtMs,
    endLatencyMs: endedAtMs - endSentAtMs,
    wallDurationMs: endedAtMs - streamStartedAtMs,
  };
}

async function waitForHistory(apiBaseUrl, sessionId, minimumSegments, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let detail;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}`);
    if (response.ok) {
      detail = await response.json();
      if (detail.status === "ended" && detail.segments?.length >= minimumSegments) return detail;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`history did not converge for ${sessionId}: ${JSON.stringify(detail)}`);
}

function evaluateTailIteration(stream, detail) {
  const transcriptFinals = stream.events.filter((event) =>
    event.type === "transcript.final" && event.text?.trim());
  const translationFinals = stream.events.filter((event) =>
    event.type === "translation.final" && event.text?.trim());
  const segments = (detail.segments ?? []).filter((segment) => segment.sourceText?.trim());
  const complete = segments.filter((segment) => segment.translatedText?.trim());
  const eventErrors = stream.events.filter((event) => event.type === "error");
  const flush = stream.endedEvent.flush;
  const errors = [
    ...(transcriptFinals.length < 1 ? ["no transcript.final"] : []),
    ...(translationFinals.length < 1 ? ["no translation.final"] : []),
    ...(segments.length < 1 ? ["history has no source segment"] : []),
    ...(complete.length < 1 ? ["history tail has no translation"] : []),
    ...(detail.status !== "ended" ? [`history status is ${detail.status}`] : []),
    ...(eventErrors.length > 0 ? ["realtime error event emitted"] : []),
    ...(flush?.status === "degraded" ? ["session flush is degraded"] : []),
  ];
  return { ok: errors.length === 0, errors, segments, eventErrors };
}

async function runTailGate(config, fixture) {
  const results = [];
  for (let index = 0; index < config.iterations; index += 1) {
    let result;
    try {
      const session = await createSession(config);
      const stream = await streamSession(session, fixture, { ...config, repeats: 1 });
      const detail = await waitForHistory(
        config.apiBaseUrl,
        session.sessionId,
        1,
        config.sessionTimeoutMs,
      );
      result = {
        iteration: index + 1,
        sessionId: session.sessionId,
        endLatencyMs: stream.endLatencyMs,
        ...evaluateTailIteration(stream, detail),
      };
    } catch (error) {
      result = { iteration: index + 1, ok: false, errors: [String(error)] };
    }
    results.push(result);
    console.log(JSON.stringify({
      progress: true,
      mode: "tail",
      iteration: index + 1,
      iterations: config.iterations,
      ok: result.ok,
      endLatencyMs: result.endLatencyMs,
    }));
  }
  return { mode: "tail", results, summary: summarizeTailResults(results) };
}

async function runLongGate(config, fixture) {
  const session = await createSession(config);
  const stream = await streamSession(session, fixture, config);
  const detail = await waitForHistory(
    config.apiBaseUrl,
    session.sessionId,
    config.minimumSegments,
    config.sessionTimeoutMs,
  );
  const segments = (detail.segments ?? []).filter((segment) => segment.sourceText?.trim());
  const result = {
    sessionId: session.sessionId,
    sequence: stream.sequence,
    audioElapsedMs: stream.audioElapsedMs,
    wallDurationMs: stream.wallDurationMs,
    endLatencyMs: stream.endLatencyMs,
    segments,
    droppedFrameCount: detail.diagnostics?.audio?.droppedFrameCount ?? -1,
    eventErrors: stream.events.filter((event) => event.type === "error"),
    flush: stream.endedEvent.flush,
  };
  return {
    mode: "long",
    result,
    summary: evaluateLongResult(result, {
      minimumWallDurationMs: config.minimumWallDurationMs,
      minimumSegments: config.minimumSegments,
      minimumTranslationCoverage: config.minimumTranslationCoverage,
    }),
  };
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

async function main() {
  const mode = process.env.WUJIE_GATE_MODE ?? "tail";
  if (mode !== "tail" && mode !== "long") throw new Error(`unsupported mode ${mode}`);
  const fixturePath = resolve(process.env.WUJIE_GATE_FIXTURE ?? (
    mode === "tail"
      ? "test-audio/realtime-online-eval-v1/clean-24k-wav/rt_p0_flush_001.wav"
      : "test-audio/realtime-online-eval-v1/full-regression-24k.wav"
  ));
  const fixture = readPcm16MonoWav(fixturePath);
  const config = {
    apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:3110",
    sessionMode: process.env.WUJIE_SESSION_MODE ?? "conversation",
    sourceLanguage: process.env.WUJIE_SOURCE_LANGUAGE ?? "auto",
    targetLanguage: process.env.WUJIE_TARGET_LANGUAGE ?? "zh",
    frameMs: numberEnv("WUJIE_FRAME_MS", 80),
    progressIntervalMs: numberEnv("WUJIE_PROGRESS_INTERVAL_MS", 60_000),
    sessionTimeoutMs: numberEnv("WUJIE_SESSION_TIMEOUT_MS", 30_000),
    iterations: numberEnv("WUJIE_TAIL_ITERATIONS", 100),
    repeats: numberEnv("WUJIE_LONG_REPEATS", 19),
    minimumWallDurationMs: numberEnv("WUJIE_LONG_MIN_WALL_MS", 1_800_000),
    minimumSegments: numberEnv("WUJIE_LONG_MIN_SEGMENTS", 100),
    minimumTranslationCoverage: numberEnv("WUJIE_LONG_MIN_TRANSLATION_COVERAGE", 0.99),
  };
  const report = mode === "tail"
    ? await runTailGate(config, fixture)
    : await runLongGate(config, fixture);
  const output = resolve(process.env.WUJIE_GATE_EVIDENCE ??
    `.cache/wujie-productization-batch1/${mode}-reliability-gate.json`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fixturePath,
    config,
    ...report,
  }, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ output, ...report.summary }, null, 2));
  if (!report.summary.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
