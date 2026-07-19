import { describe, expect, it } from "vitest";
import { translateIncrementally } from
  "../worker/incremental-provider-stream.js";
import { StickyProviderFallbackController } from
  "../worker/provider-fallback-controller.js";
import type {
  CallTranslationProvider,
  CallTtsProvider,
} from "../worker/types.js";
import { FallbackTranslationProvider } from "./fallback-translation-provider.js";
import { FallbackTtsProvider } from "./fallback-tts-provider.js";

describe("streaming provider fallback", () => {
  it("restarts buffered translation after a partial primary stream", async () => {
    const primary: CallTranslationProvider = {
      async translate() { throw new Error("unused"); },
      async *translateStream() {
        yield { type: "delta", text: "stale" };
        throw new Error("Translation stream returned HTTP 503");
      },
    };
    const fallback: CallTranslationProvider = {
      async translate() { return "fresh"; },
    };
    const provider = new FallbackTranslationProvider({
      primary,
      fallback,
      controller: controller("translation"),
    });
    const restarts: number[] = [];
    const result = await translateIncrementally(provider, translationInput(), {
      onFirstToken: () => undefined,
      onRestart: () => restarts.push(1),
    });
    expect(result).toBe("fresh");
    expect(restarts).toHaveLength(1);
  });

  it("restarts fallback before primary emits audio", async () => {
    const primary: CallTtsProvider = {
      async synthesize() { throw new Error("unused"); },
      async *synthesizeStream() {
        yield { type: "metadata", speech: { provider: "primary" } };
        throw new Error("HTTP TTS stream returned HTTP 503");
      },
    };
    const fallback: CallTtsProvider = {
      async synthesize() {
        return {
          provider: "fallback",
          audio: { format: "pcm16" as const, sampleRate: 24000 as const, data: "AwQ=" },
        };
      },
    };
    const provider = new FallbackTtsProvider({
      primary,
      fallback,
      controller: controller("tts"),
    });
    const events = [];
    for await (const event of provider.synthesizeStream!(ttsInput())) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "metadata", "restart", "metadata", "audio_chunk", "final",
    ]);
    expect(events[3]).toMatchObject({
      type: "audio_chunk",
      audio: { data: "AwQ=" },
    });
  });

  it("does not replay a sentence after primary audio has started", async () => {
    const primary: CallTtsProvider = {
      async synthesize() { throw new Error("unused"); },
      async *synthesizeStream() {
        yield { type: "metadata", speech: { provider: "primary" } };
        yield {
          type: "audio_chunk",
          sequence: 1,
          audio: { format: "pcm16", sampleRate: 24000, data: "AQI=" },
        };
        throw new Error("HTTP TTS stream returned HTTP 503");
      },
    };
    const provider = new FallbackTtsProvider({
      primary,
      fallback: { async synthesize() { throw new Error("must not replay"); } },
      controller: controller("tts"),
    });

    await expect((async () => {
      for await (const _event of provider.synthesizeStream!(ttsInput())) {
        // Drain the stream.
      }
    })()).rejects.toThrow("HTTP TTS stream returned HTTP 503");
  });
});

function controller(stage: "translation" | "tts") {
  return new StickyProviderFallbackController({
    stage,
    primary: { provider: "primary" },
    fallback: { provider: "fallback" },
    failureThreshold: 1,
    cooldownMs: 30000,
  });
}

function translationInput() {
  return {
    callId: "call-1",
    text: "你好",
    sourceLanguage: "zh" as const,
    targetLanguage: "en" as const,
    speechId: "speech-1",
    turnId: "turn-1",
    revision: 1,
    pipelineGeneration: 1,
    signal: new AbortController().signal,
  };
}

function ttsInput() {
  return {
    callId: "call-1",
    text: "hello",
    language: "en" as const,
    speakerRole: "host" as const,
    segmentId: "segment-1",
    speechId: "speech-1",
    turnId: "turn-1",
    revision: 1,
    pipelineGeneration: 1,
    signal: new AbortController().signal,
  };
}
