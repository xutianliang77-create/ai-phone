import { createHmac } from "node:crypto";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type { RealtimeTokenClaims } from "@translation/contracts";
import { deleteSession, getSession } from "../sessions/session-manager.js";
import { startWebSocketServer } from "./websocket-server.js";

const sessionId = "disconnect-integration-test";
const secret = "disconnect-test-secret";
const previousEnv = new Map<string, string | undefined>();

describe("websocket disconnect recovery", () => {
  afterEach(() => {
    deleteSession(sessionId);
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it("resumes an expired admission token only while its session remains resumable", async () => {
    setEnv("REALTIME_PORT", "0");
    setEnv("REALTIME_TOKEN_SECRET", secret);
    setEnv("REALTIME_PROVIDER", "mock");
    setEnv("ASR_PROVIDER", "mock");
    setEnv("SESSION_EVENT_SINK", "noop");
    setEnv("REALTIME_ALLOWED_HOSTS", "127.0.0.1");
    setEnv("REALTIME_ALLOW_NON_BROWSER_CLIENTS_WITHOUT_ORIGIN", "true");
    const server = startWebSocketServer();
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Gateway did not expose a TCP address");
    }
    const url = `ws://127.0.0.1:${address.port}/realtime?token=${token()}`;

    const first = new WebSocket(url, { headers: { host: "127.0.0.1" } });
    await waitForEvent(first, "session.started");
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    first.close();
    await new Promise<void>((resolve) => first.once("close", resolve));
    await waitFor(() => getSession(sessionId)?.status === "connecting");

    const second = new WebSocket(url, { headers: { host: "127.0.0.1" } });
    await waitForEvent(second, "session.started");
    second.send(JSON.stringify({ type: "session.resume", sessionId }));
    await waitForEvent(second, "session.resumed");
    expect(getSession(sessionId)).toMatchObject({
      status: "active",
      connectionGeneration: 2,
    });

    second.send(JSON.stringify({ type: "session.end", sessionId }));
    await waitForEvent(second, "session.ended");
    await new Promise<void>((resolve) => second.once("close", resolve));
    await waitFor(() => getSession(sessionId) === null);
    const rejected = new WebSocket(url, { headers: { host: "127.0.0.1" } });
    await waitForEvent(rejected, "error");
    await new Promise<void>((resolve) => rejected.once("close", resolve));
    expect(getSession(sessionId)).toBeNull();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function setEnv(key: string, value: string) {
  previousEnv.set(key, process.env[key]);
  process.env[key] = value;
}

function token() {
  const claims: RealtimeTokenClaims = {
    userId: "guest-user",
    sessionId,
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 2,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function waitForEvent(ws: WebSocket, type: string) {
  return new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as { type?: string };
      if (event.type === type) resolve();
      else if (event.type === "error") reject(new Error(data.toString()));
    });
  });
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for Gateway session state");
}
