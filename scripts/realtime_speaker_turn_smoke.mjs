#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import WebSocket from "ws";
import {
  evaluateRealtimeSpeakerTurnReadiness,
  joinNoGapWavFixtures,
} from "./lib/realtime_speaker_turn_readiness.mjs";

const apiBaseUrl = env("API_BASE_URL", "http://127.0.0.1:3110");
const fixturePaths = env(
  "SPEAKER_TURN_FIXTURES",
  "test-audio/iphone14-small-models/diar_001-24k.wav," +
    "test-audio/iphone14-small-models/diar_002-24k.wav",
).split(",").map((path) => resolve(path.trim()));
const frameMs = numberEnv("SPEAKER_TURN_FRAME_MS", 80);
const tailMs = numberEnv("SPEAKER_TURN_TAIL_MS", 2500);
const timeoutMs = numberEnv("SPEAKER_TURN_TIMEOUT_MS", 60_000);
const sessionMode = env("SPEAKER_TURN_MODE", "conversation");
const sourceLanguage = env("SPEAKER_TURN_SOURCE_LANGUAGE", "auto");
const targetLanguage = env("SPEAKER_TURN_TARGET_LANGUAGE", "zh");
const expectedSpeakerCount = numberEnv("SPEAKER_TURN_EXPECTED_SPEAKERS", 2);
const minimumSegments = numberEnv(
  "SPEAKER_TURN_MIN_SEGMENTS",
  expectedSpeakerCount,
);
const requireBoundary = booleanEnv(
  "SPEAKER_TURN_REQUIRE_BOUNDARY",
  expectedSpeakerCount > 1,
);
const requiredLanguages = env(
  "SPEAKER_TURN_REQUIRED_LANGUAGES",
  "zh,en",
).split(",").map((value) => value.trim()).filter(Boolean);
const maximumHistoryLatencyMs = numberEnv(
  "SPEAKER_TURN_MAX_END_PERSISTENCE_MS",
  1500,
);
const evidencePath = resolve(env(
  "SPEAKER_TURN_EVIDENCE",
  `.cache/realtime-speaker-turn/${timestamp()}/result.json`,
));

const gatewayHealth = await fetchGatewayHealth();
const speakerHealthUrl = env("SPEAKER_HEALTH_URL", `${gatewayHealth.speakerEndpoint}/health`);
const speakerHealth = await fetchJsonUrl(speakerHealthUrl);
const session = await createSession();
const stream = await streamSession(session);
const events = stream.events;
const detail = await waitForHistory(session.sessionId);
const historyObservedAtMs = Date.now();
const historyReady = detail.status === "ended" &&
  detail.segments?.length >= minimumSegments && Boolean(detail.diagnostics);
const endDelivery = {
  sentAtMs: stream.endSentAtMs,
  eventAtMs: stream.endedEventAtMs,
  eventLatencyMs: stream.endedEventAtMs - stream.endSentAtMs,
  historyObservedAtMs,
  historyLatencyMs: historyObservedAtMs - stream.endSentAtMs,
  historyReady,
};
const readiness = evaluateRealtimeSpeakerTurnReadiness({
  gatewayHealth,
  speakerHealth,
  detail,
  endDelivery,
}, {
  expectedSpeakerCount,
  requireBoundary,
  requiredLanguages,
  maximumHistoryLatencyMs,
});
const evidence = {
  generatedAt: new Date().toISOString(),
  apiBaseUrl,
  fixturePaths,
  sessionId: session.sessionId,
  audioStartedAtMs: stream.audioStartedAtMs,
  gateOptions: {
    expectedSpeakerCount,
    minimumSegments,
    requireBoundary,
    requiredLanguages,
  },
  eventTypes: events.map((event) => event.type),
  sessionEndedEvent: events.find((event) => event.type === "session.ended") ?? null,
  endDelivery,
  transcriptEvents: events.filter((event) =>
    event.type === "transcript.final" ||
    event.type === "translation.final"
  ),
  gatewayHealth,
  speakerHealth,
  detail,
  readiness,
};
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({
  ok: readiness.ok,
  sessionId: session.sessionId,
  evidencePath,
  ...readiness,
}, null, 2));
if (!readiness.ok) process.exitCode = 2;

async function createSession() {
  const response = await fetch(`${apiBaseUrl}/realtime/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: sessionMode,
      sourceLanguage,
      targetLanguage,
      autoReverseTargetLanguage: true,
      voiceOutput: false,
      speakerAttribution: {
        mode: "auto",
        maxSpeakers: 4,
        allowVoiceIdentity: false,
      },
    }),
  });
  if (!response.ok) throw new Error(`Create session failed: ${await response.text()}`);
  return response.json();
}

async function fetchGatewayHealth() {
  const apiHealth = await fetchJsonUrl(`${apiBaseUrl}/health`);
  const url = new URL(apiHealth.realtimeWsEndpoint);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/health";
  url.search = "";
  return fetchJsonUrl(url.toString());
}

async function streamSession(session) {
  const fixture = joinNoGapWavFixtures(fixturePaths);
  const bytesPerFrame = Math.round(fixture.sampleRate * 2 * frameMs / 1000);
  const events = [];
  const ws = new WebSocket(session.endpoint, [
    "ai-phone.realtime.v1",
    `ai-phone.token.${session.realtimeToken}`,
  ]);
  await waitForSocketOpen(ws);
  const ended = waitForSessionEnded(ws, events);
  const startedAt = Date.now();
  let sequence = 0;
  for (let offset = 0; offset < fixture.pcm.length; offset += bytesPerFrame) {
    const bytes = fixture.pcm.subarray(offset, offset + bytesPerFrame);
    ws.send(JSON.stringify({
      type: "audio.frame",
      sessionId: session.sessionId,
      sequence: ++sequence,
      timestampMs: startedAt + Math.round(offset / 2 / fixture.sampleRate * 1000),
      format: "pcm16",
      sampleRate: fixture.sampleRate,
      data: bytes.toString("base64"),
    }));
    await sleep(frameMs);
  }
  await sleep(tailMs);
  const endSentAtMs = Date.now();
  ws.send(JSON.stringify({ type: "session.end", sessionId: session.sessionId }));
  await ended;
  const endedEventAtMs = Date.now();
  ws.close();
  return { events, audioStartedAtMs: startedAt, endSentAtMs, endedEventAtMs };
}

function waitForSocketOpen(ws) {
  return new Promise((resolveOpen, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), timeoutMs);
    ws.once("open", () => { clearTimeout(timer); resolveOpen(); });
    ws.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

function waitForSessionEnded(ws, events) {
  return new Promise((resolveEnded, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime session timed out")), timeoutMs);
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString());
      events.push(event);
      if (event.type === "error") {
        clearTimeout(timer);
        reject(new Error(`${event.code}: ${event.message}`));
      }
      if (event.type === "session.ended") {
        clearTimeout(timer);
        resolveEnded();
      }
    });
    ws.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

async function waitForHistory(sessionId) {
  const deadline = Date.now() + timeoutMs;
  let detail;
  while (Date.now() < deadline) {
    detail = await fetchJsonUrl(`${apiBaseUrl}/sessions/${sessionId}`);
    if (
      detail.status === "ended" &&
      detail.segments?.length >= minimumSegments &&
      detail.diagnostics
    ) {
      return detail;
    }
    await sleep(200);
  }
  return detail;
}

async function fetchJsonUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} failed: ${await response.text()}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function numberEnv(name, fallback) {
  const value = Number(env(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function booleanEnv(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
}
