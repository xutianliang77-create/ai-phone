import { describe, expect, it } from "vitest";
import { HttpAsrClient } from "./http-asr-client.js";

const frame = {
  sessionId: "sess_1",
  sequence: 1,
  timestampMs: 1,
  format: "pcm16" as const,
  sampleRate: 24000,
  data: "AA==",
  sourceLanguage: "en",
  targetLanguage: "zh",
};

describe("http asr client timing", () => {
  it("propagates valid segment and token timings", async () => {
    const client = clientFor({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
      timing: { startMs: 100, endMs: 900, source: "client" },
      tokenTimings: [{ text: "hello", startMs: 100, endMs: 900 }],
    });

    const transcript = await client.transcribe(frame);

    expect(transcript.timing).toEqual({
      startMs: 100,
      endMs: 900,
      source: "client",
    });
    expect(transcript.tokenTimings).toEqual([
      { text: "hello", startMs: 100, endMs: 900 },
    ]);
  });

  it("drops malformed or non-monotonic token timings", async () => {
    const client = clientFor({
      segmentId: "seg_1",
      text: "hello world",
      language: "en",
      tokenTimings: [
        { text: "world", startMs: 500, endMs: 800 },
        { text: "hello", startMs: 100, endMs: 400 },
      ],
    });

    const transcript = await client.transcribe(frame);

    expect(transcript).not.toHaveProperty("tokenTimings");
  });
});

function clientFor(body: unknown): HttpAsrClient {
  return new HttpAsrClient({
    endpoint: "http://127.0.0.1:8001/asr/transcribe",
    timeoutMs: 100,
    fetchFn: (async () => ({
      ok: true,
      status: 200,
      json: async () => body,
    })) as typeof fetch,
  });
}
