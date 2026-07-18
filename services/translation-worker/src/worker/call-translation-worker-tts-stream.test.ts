import { expect, it } from "vitest";
import {
  FakeAsrProvider,
  RecordingSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import type {
  CallTtsAudioChunk,
  CallTtsAudioSink,
  CallTtsProvider,
  SynthesizedSpeech,
} from "./types.js";

it("writes ordered TTS chunks before the provider stream is final", async () => {
  const asr = new FakeAsrProvider({
    segmentId: "seg_stream",
    text: "你好",
    language: "zh",
  });
  const sink = new RecordingSink();
  const provider = new StreamingTtsProvider();
  const audioSink = new StreamingRecordingSink();
  const worker = newWorker(asr, sink, provider, audioSink);

  await worker.processAudioFrame(frame("call_stream", "host"));
  await waitUntil(() => audioSink.chunks.length === 2);
  expect(provider.finalEmitted).toBe(false);
  provider.releaseFinal();
  await worker.endCall("call_stream");

  expect(audioSink.chunks.map((chunk) => chunk.sequence)).toEqual([1, 2]);
  expect(Buffer.concat(audioSink.chunks.map((chunk) =>
    Buffer.from(chunk.audio.data, "base64")
  )).toString("base64")).toBe("AAECAw==");
});

class StreamingTtsProvider implements CallTtsProvider {
  private release!: () => void;
  private readonly finalGate = new Promise<void>((resolve) => {
    this.release = resolve;
  });
  finalEmitted = false;

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
    await this.finalGate;
    this.finalEmitted = true;
    yield { type: "final" as const, audioDurationMs: 1 };
  }

  releaseFinal() {
    this.release();
  }
}

class StreamingRecordingSink implements CallTtsAudioSink {
  readonly capabilities = {
    bidirectionalMedia: true,
    streamingWrite: true,
    clearPlayback: false,
  } as const;
  readonly chunks: CallTtsAudioChunk[] = [];

  async play() {
    throw new Error("whole-response playback must not be used");
  }

  async playStream(
    input: Parameters<NonNullable<CallTtsAudioSink["playStream"]>>[0],
  ) {
    for await (const chunk of input.audioStream) this.chunks.push(chunk);
    return { status: "played" as const };
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
