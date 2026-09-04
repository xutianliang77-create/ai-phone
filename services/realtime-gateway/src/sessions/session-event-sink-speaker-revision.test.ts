import { describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";
import { createSessionEventSink } from "./session-event-sink.js";

describe("session event sink speaker revisions", () => {
  it("syncs speaker revisions independently from transcript revisions", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response("{}", { status: 200 });
    };

    try {
      const sink = createSessionEventSink({
        ...loadEnv(),
        sessionEventSink: "api",
        apiBaseUrl: "http://127.0.0.1:3100",
      });
      await sink.record({
        type: "speaker.updated",
        sessionId: "sess_1",
        segmentId: "seg_1",
        turnId: "turn_1",
        speakerRevision: 2,
        speaker: {
          speakerId: "speaker_2",
          role: "speaker",
          source: "diarization",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([{
      url: "http://127.0.0.1:3100/internal/realtime/segments",
      body: {
        sessionId: "sess_1",
        segmentId: "seg_1",
        turnId: "turn_1",
        speakerRevision: 2,
        speaker: {
          speakerId: "speaker_2",
          role: "speaker",
          source: "diarization",
        },
      },
    }]);
  });
});
