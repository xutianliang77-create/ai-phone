import { expect, it } from "vitest";
import {
  FakeAsrProvider,
  RecordingSink,
  RecordingTtsAudioSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import type { CallTtsProvider, SynthesizedSpeech } from "./types.js";

it("assembles ordered TTS stream chunks before playback", async () => {
  const asr = new FakeAsrProvider({
    segmentId: "seg_stream",
    text: "你好",
    language: "zh",
  });
  const sink = new RecordingSink();
  const audioSink = new RecordingTtsAudioSink();
  const worker = newWorker(asr, sink, new StreamingTtsProvider(), audioSink);

  await worker.processAudioFrame(frame("call_stream", "host"));
  await waitUntil(() => audioSink.played.length === 1);
  await worker.endCall("call_stream");

  expect(audioSink.played[0].speech.audio).toEqual({
    format: "pcm16",
    sampleRate: 24000,
    data: "AAECAw==",
  });
});

class StreamingTtsProvider implements CallTtsProvider {
  async synthesize(): Promise<SynthesizedSpeech | null> {
    throw new Error("whole-response synthesis must not be used");
  }

  async *synthesizeStream() {
    yield {
      type: "metadata" as const,
      speech: {
        provider: "stream-tts",
        model: "stream-model",
        firstAudioMs: 20,
      },
    };
    yield {
      type: "audio_chunk" as const,
      sequence: 1,
      audio: { format: "pcm16" as const, sampleRate: 24000 as const, data: "AAE=" },
    };
    yield {
      type: "audio_chunk" as const,
      sequence: 2,
      audio: { format: "pcm16" as const, sampleRate: 24000 as const, data: "AgM=" },
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
