import { describe, expect, it } from "vitest";
import { CallTranslationWorker } from "./call-translation-worker.js";
import {
  FakeAsrProvider,
  RecordingSink,
  frame,
} from "./call-translation-worker.test-support.js";
import type {
  CallTranslationProvider,
  CallTtsProvider,
  SynthesizedSpeech,
} from "./types.js";

describe("CallTranslationWorker pipeline timing", () => {
  it("records first MT token and first TTS audio from streaming providers", async () => {
    let clock = 100;
    const sink = new RecordingSink();
    const worker = new CallTranslationWorker({
      asrProvider: new FakeAsrProvider({
        segmentId: "segment_1",
        text: "hello",
        language: "en",
      }),
      translationProvider: new StreamingTranslationProvider(),
      ttsProvider: new StreamingTtsProvider(),
      eventSink: sink,
      nowMs: () => {
        clock += 10;
        return clock;
      },
    });

    await worker.processAudioFrame(frame("call_1", "guest"));
    await waitUntil(() => sink.eventsFor("call_1").some(
      (event) => event.type === "tts.ready",
    ));

    const translation = sink.eventsFor("call_1").find(
      (event) => event.type === "translation.final",
    )!;
    const tts = sink.eventsFor("call_1").find(
      (event) => event.type === "tts.ready",
    )!;
    expect(translation.pipelineTiming?.translationFirstTokenAtMs)
      .toBeGreaterThan(translation.pipelineTiming?.translationStartedAtMs ?? 0);
    expect(translation.pipelineTiming?.translationFirstTokenAtMs)
      .toBeLessThan(translation.pipelineTiming?.translationFinalAtMs ?? 0);
    expect(tts.pipelineTiming?.ttsFirstAudioAtMs)
      .toBeGreaterThan(tts.pipelineTiming?.ttsStartedAtMs ?? 0);
    expect(tts.pipelineTiming?.ttsFirstAudioAtMs)
      .toBe(tts.pipelineTiming?.ttsReadyAtMs);
  });
});

class StreamingTranslationProvider implements CallTranslationProvider {
  async translate(): Promise<string> {
    throw new Error("whole-response translation must not be used");
  }

  async *translateStream() {
    yield { type: "delta" as const, text: "你" };
    yield { type: "final" as const, text: "你好" };
  }
}

class StreamingTtsProvider implements CallTtsProvider {
  async synthesize(): Promise<SynthesizedSpeech | null> {
    throw new Error("whole-response synthesis must not be used");
  }

  async *synthesizeStream() {
    yield {
      type: "metadata" as const,
      speech: { provider: "stream-tts", model: "stream-model" },
    };
    yield {
      type: "audio_chunk" as const,
      sequence: 1,
      audio: { format: "pcm16" as const, sampleRate: 24000 as const, data: "AAE=" },
    };
    yield { type: "final" as const };
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
