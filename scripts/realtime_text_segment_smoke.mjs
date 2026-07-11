#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import process from "node:process";
import WebSocket from "ws";

const apiBaseUrl = env("API_BASE_URL", "http://127.0.0.1:3100");
const sourceText = env("TEXT_SEGMENT_SOURCE_TEXT", "hello from native device asr");
const sourceLanguage = env("TEXT_SEGMENT_SOURCE_LANGUAGE", "en");
const targetLanguage = env("TEXT_SEGMENT_TARGET_LANGUAGE", "zh");
const timeoutMs = Number(env("TEXT_SEGMENT_TIMEOUT_MS", "8000"));
const expectHistory = env("TEXT_SEGMENT_EXPECT_HISTORY", "true") !== "false";

const session = await createRealtimeSession();
if (expectHistory) await assertGatewayHistorySink(session.endpoint);
const events = await runRealtimeSession(session);
const detail = expectHistory ? await waitForHistory(session.sessionId) : null;

assertEvent(events, "session.started");
assertEvent(events, "transcript.final");
assertEvent(events, "translation.final");
assertEvent(events, "session.ended");
if (detail) assertHistory(detail);

console.log(JSON.stringify({
  ok: true,
  sessionId: session.sessionId,
  endpoint: session.endpoint,
  events: events.map((event) => event.type),
  historySegmentCount: detail?.segments?.length ?? null,
  historyStatus: detail?.status ?? null,
}, null, 2));

async function createRealtimeSession() {
  const response = await fetch(`${apiBaseUrl}/realtime/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "conversation",
      sourceLanguage,
      targetLanguage,
      voiceOutput: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`create realtime session failed: HTTP ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

function runRealtimeSession(session) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`text segment smoke timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const url = `${session.endpoint}?token=${encodeURIComponent(session.realtimeToken)}`;
    const ws = new WebSocket(url);
    let sentText = false;
    let sentEnd = false;

    ws.on("message", (data) => {
      const event = JSON.parse(data.toString());
      events.push(event);
      if (event.type === "session.started" && !sentText) {
        sentText = true;
        ws.send(JSON.stringify({
          type: "client.text.segment",
          sessionId: session.sessionId,
          segmentId: `native_text_smoke_${randomUUID()}`,
          text: sourceText,
          language: sourceLanguage === "auto" ? "en" : sourceLanguage,
          isFinal: true,
          confidence: 0.99,
        }));
      }
      if (event.type === "translation.final" && !sentEnd) {
        sentEnd = true;
        ws.send(JSON.stringify({ type: "session.end", sessionId: session.sessionId }));
      }
      if (event.type === "session.ended") {
        clearTimeout(timer);
        ws.close();
        resolve(events);
      }
      if (event.type === "error") {
        clearTimeout(timer);
        ws.close();
        reject(new Error(`gateway error: ${event.code} ${event.message}`));
      }
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function fetchJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`fetch ${path} failed: HTTP ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function assertGatewayHistorySink(endpoint) {
  const healthUrl = gatewayHealthUrl(endpoint);
  const response = await fetch(healthUrl);
  if (!response.ok) {
    throw new Error(`gateway health failed: HTTP ${response.status} ${await response.text()}`);
  }
  const health = await response.json();
  if (health.sessionEventSink !== "api") {
    throw new Error(
      `gateway sessionEventSink must be api for history smoke; got ${health.sessionEventSink ?? "missing"}`,
    );
  }
}

function gatewayHealthUrl(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  url.pathname = "/health";
  url.search = "";
  return url.toString();
}

async function waitForHistory(sessionId) {
  const startedAt = Date.now();
  let lastDetail = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastDetail = await fetchJson(`/sessions/${sessionId}`);
    const matching = lastDetail.segments?.find((segment) =>
      segment.sourceText === sourceText && segment.translatedText
    );
    if (matching && lastDetail.status === "ended") return lastDetail;
    await sleep(100);
  }
  return lastDetail;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertEvent(events, type) {
  if (!events.some((event) => event.type === type)) {
    throw new Error(`missing realtime event ${type}`);
  }
}

function assertHistory(detail) {
  const matching = detail.segments?.find((segment) => segment.sourceText === sourceText);
  if (!matching) throw new Error("API history does not contain smoke source text");
  if (!matching.translatedText) throw new Error("API history smoke segment has no translation");
  if (detail.status !== "ended") throw new Error(`API history status is not ended: ${detail.status}`);
}

function env(name, fallback) {
  return process.env[name] || fallback;
}
