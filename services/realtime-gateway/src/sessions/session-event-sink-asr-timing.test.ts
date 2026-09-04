import { describe, expect, it } from "vitest";
import type { RealtimeEnv } from "../config/env.js";
import { createSessionEventSink } from "./session-event-sink.js";

describe("session event sink ASR timing", () => {
  it("persists final segment and token timings", async () => {
    let body: unknown;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    };

    try {
      const sink = createSessionEventSink({
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
        sessionSyncTimeoutMs: 5_000,
      } as RealtimeEnv);
      await sink.record({
        type: "transcript.final",
        sessionId: "sess_1",
        segmentId: "seg_1",
        text: "hello",
        language: "en",
        timing: { startMs: 100, endMs: 900, source: "client" },
        tokenTimings: [{ text: "hello", startMs: 100, endMs: 900 }],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(body).toMatchObject({
      sessionId: "sess_1",
      segmentId: "seg_1",
      timing: { startMs: 100, endMs: 900, source: "client" },
      tokenTimings: [{ text: "hello", startMs: 100, endMs: 900 }],
    });
  });
});
