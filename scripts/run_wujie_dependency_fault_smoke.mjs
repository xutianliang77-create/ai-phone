import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import WebSocket from "ws";

export function validateUnavailableHealth(health, releaseStatus) {
  if (health.status !== "unavailable") throw new Error(`gateway status is ${health.status}`);
  if (health.dependencyReadiness?.sessionReady !== false) {
    throw new Error("gateway session readiness did not fail closed");
  }
  if (releaseStatus !== 503) throw new Error(`release-ready returned HTTP ${releaseStatus}`);
}

export function validateAdmissionEvents(events) {
  if (events.some((event) => event.type === "session.started")) {
    throw new Error("session.started emitted while translation was unavailable");
  }
  const error = events.find((event) => event.type === "error");
  if (error?.code !== "provider_unavailable" || error.stage !== "translation" ||
      error.retryable !== true) {
    throw new Error(`unexpected admission error ${JSON.stringify(error)}`);
  }
  return error;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${description} timed out: ${String(last)}`);
}

async function fetchJson(url) {
  const response = await fetch(url);
  return { status: response.status, body: await response.json() };
}

async function createSession(apiBaseUrl) {
  const response = await fetch(`${apiBaseUrl}/realtime/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "conversation",
      sourceLanguage: "zh",
      targetLanguage: "en",
      voiceOutput: false,
    }),
  });
  if (!response.ok) throw new Error(`session create failed: HTTP ${response.status}`);
  return response.json();
}

function observeAdmission(session, timeoutMs) {
  return new Promise((resolveEvents, reject) => {
    const events = [];
    const socket = new WebSocket(session.endpoint, [
      "ai-phone.realtime.v1",
      `ai-phone.token.${session.realtimeToken}`,
    ]);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("dependency admission timed out"));
    }, timeoutMs);
    socket.on("message", (data) => {
      const event = JSON.parse(data.toString());
      events.push(event);
      if (event.type === "error") {
        clearTimeout(timer);
        socket.close();
        resolveEvents(events);
      }
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function runDependencyFaultSmoke({
  remoteHost,
  apiBaseUrl,
  gatewayBaseUrl,
  evidencePath,
  timeoutMs = 30_000,
}) {
  const ssh = (action) => execFileSync(
    "ssh",
    ["-o", "BatchMode=yes", remoteHost, `systemctl --user ${action} ai-phone-translation-service.service`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const evidence = { generatedAt: new Date().toISOString(), remoteHost, apiBaseUrl };
  let primaryError;
  try {
    ssh("stop");
    const unavailable = await waitFor(async () => {
      const health = await fetchJson(`${gatewayBaseUrl}/health`);
      const release = await fetch(`${gatewayBaseUrl}/health/release-ready`);
      if (health.body.status !== "unavailable") return undefined;
      return { health: health.body, releaseStatus: release.status };
    }, timeoutMs, "gateway unavailable state");
    validateUnavailableHealth(unavailable.health, unavailable.releaseStatus);
    const session = await createSession(apiBaseUrl);
    const events = await observeAdmission(session, 8_000);
    const error = validateAdmissionEvents(events);
    Object.assign(evidence, {
      sessionId: session.sessionId,
      unavailableHealth: unavailable.health,
      releaseStatus: unavailable.releaseStatus,
      eventTypes: events.map((event) => event.type),
      admissionError: error,
    });
  } catch (error) {
    primaryError = error;
  } finally {
    ssh("start");
  }
  const restored = await waitFor(async () => {
    const health = await fetchJson(`${gatewayBaseUrl}/health`);
    return health.body.status === "ok" &&
        health.body.dependencyReadiness?.releaseReady === true
      ? health.body
      : undefined;
  }, timeoutMs, "gateway dependency restoration");
  evidence.restoredHealth = restored;
  evidence.ok = !primaryError;
  if (evidencePath) {
    const output = resolve(evidencePath);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  if (primaryError) throw primaryError;
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const remoteHost = process.env.WUJIE_REMOTE_HOST;
  if (!remoteHost) throw new Error("WUJIE_REMOTE_HOST is required");
  const evidence = await runDependencyFaultSmoke({
    remoteHost,
    apiBaseUrl: process.env.API_BASE_URL ?? "http://127.0.0.1:3110",
    gatewayBaseUrl: process.env.GATEWAY_BASE_URL ?? "http://127.0.0.1:3111",
    evidencePath: process.env.WUJIE_FAULT_EVIDENCE,
  });
  console.log(JSON.stringify({
    ok: evidence.ok,
    sessionId: evidence.sessionId,
    eventTypes: evidence.eventTypes,
    releaseStatus: evidence.releaseStatus,
    restoredStatus: evidence.restoredHealth.status,
  }, null, 2));
}
