import { describe, expect, it } from "vitest";
import { MockRealtimeProvider } from "./mock-realtime-provider.js";

describe("mock realtime provider", () => {
  it("emits transcript and translation events", async () => {
    const provider = new MockRealtimeProvider();
    const events = [];

    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    });

    for await (const event of provider.sendAudio({
      type: "audio.frame",
      sessionId: "sess_1",
      sequence: 8,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 16000,
      data: "",
    })) {
      events.push(event.type);
    }

    expect(events).toEqual(["transcript.final", "translation.final"]);
  });

  it("translates client text segments from mobile ASR", async () => {
    const provider = new MockRealtimeProvider();
    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
      voiceOutput: false,
    });

    const events = [];
    for await (const event of provider.sendText({
      sessionId: "sess_1",
      segmentId: "native_1",
      text: "hello",
      language: "en",
      isFinal: true,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
    expect(events[0]).toMatchObject({
      segmentId: "native_1",
      text: "hello",
    });
  });
});
