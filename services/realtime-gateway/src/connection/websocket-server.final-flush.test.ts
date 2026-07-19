import { createHmac } from "node:crypto";
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import type {
  RealtimeTokenClaims,
  ServerRealtimeEvent,
} from "@translation/contracts";
import { deleteSession } from "../sessions/session-manager.js";
import { startWebSocketServer } from "./websocket-server.js";
import {
  realtimeProtocol,
  realtimeTokenProtocol,
} from "../auth/realtime-connection-token.js";

const sessionId = "final-flush-integration-test";
const secret = "final-flush-test-secret";
const previousEnv = new Map<string, string | undefined>();

describe("websocket final flush", () => {
  afterEach(() => {
    deleteSession(sessionId);
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it("flushes pending audio and translation before session ended", async () => {
    setEnv("REALTIME_PORT", "0");
    setEnv("REALTIME_TOKEN_SECRET", secret);
    setEnv("REALTIME_PROVIDER", "mock");
    setEnv("ASR_PROVIDER", "mock");
    setEnv("SESSION_EVENT_SINK", "noop");
    const server = startWebSocketServer();
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Gateway did not expose a TCP address");
    }

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/realtime`, [
      realtimeProtocol,
      realtimeTokenProtocol(token()),
    ]);
    await waitForEvent(ws, "session.started");
    expect(ws.protocol).toBe(realtimeProtocol);
    const finalEvents = collectUntilEnded(ws);
    for (let sequence = 1; sequence <= 8; sequence += 1) {
      ws.send(JSON.stringify(audioFrame(sequence)));
    }
    ws.send(JSON.stringify({ type: "session.end", sessionId }));

    const events = await finalEvents;
    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "session.ended",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "session.ended",
      flush: {
        status: "completed",
        transcriptFinalCount: 1,
        translationFinalCount: 1,
        unresolvedSegmentCount: 0,
        audioFlushed: true,
        providerFlushed: true,
      },
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

function setEnv(key: string, value: string) {
  previousEnv.set(key, process.env[key]);
  process.env[key] = value;
}

function audioFrame(sequence: number) {
  return {
    type: "audio.frame",
    sessionId,
    sequence,
    timestampMs: sequence,
    format: "pcm16",
    sampleRate: 24000,
    data: "AA==",
  };
}

function collectUntilEnded(ws: WebSocket) {
  return new Promise<ServerRealtimeEvent[]>((resolve, reject) => {
    const events: ServerRealtimeEvent[] = [];
    ws.on("error", reject);
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as ServerRealtimeEvent;
      events.push(event);
      if (event.type === "session.ended") resolve(events);
    });
  });
}

function waitForEvent(ws: WebSocket, type: string) {
  return new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as { type?: string };
      if (event.type === type) resolve();
    });
  });
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  const claims: RealtimeTokenClaims = {
    userId: "guest-user",
    sessionId,
    sourceLanguage: "en",
    targetLanguage: "zh",
    voiceOutput: false,
    planCode: "free",
    maxDurationSeconds: 300,
    issuedAt: now,
    expiresAt: now + 60,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}
