import { describe, expect, it } from "vitest";
import { MockAsrProvider } from "./mock-asr-provider.js";

describe("mock asr provider", () => {
  it("emits an english transcript on the configured frame interval", async () => {
    const provider = new MockAsrProvider({ emitEveryFrames: 2 });
    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    const first = await provider.transcribe(audioFrame(1));
    const second = await provider.transcribe(audioFrame(2));

    expect(first).toBeNull();
    expect(second?.language).toBe("en");
    expect(second?.text).toContain("realtime translation test");
  });

  it("uses the opposite target language when source is auto", async () => {
    const provider = new MockAsrProvider({ emitEveryFrames: 1 });
    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });

    const transcript = await provider.transcribe(audioFrame(1));

    expect(transcript?.language).toBe("zh");
  });

  it("ignores duplicate audio frame sequences", async () => {
    const provider = new MockAsrProvider({ emitEveryFrames: 1 });
    await provider.createSession({
      sessionId: "sess_1",
      sourceLanguage: "en",
      targetLanguage: "zh",
    });

    await provider.transcribe(audioFrame(1));
    const duplicate = await provider.transcribe(audioFrame(1));

    expect(duplicate).toBeNull();
  });
});

function audioFrame(sequence: number) {
  return {
    type: "audio.frame" as const,
    sessionId: "sess_1",
    sequence,
    timestampMs: sequence,
    format: "pcm16" as const,
    sampleRate: 24000,
    data: "AA==",
  };
}
