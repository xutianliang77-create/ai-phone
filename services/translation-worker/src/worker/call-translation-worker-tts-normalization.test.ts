import type { CallRoomSubmittedEvent } from "@translation/contracts";
import { describe, expect, it } from "vitest";
import { CallTranslationWorker } from "./call-translation-worker.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallRoomEventSink,
  CallTtsProvider,
  CallTranslationProvider,
  SynthesizedSpeech,
  TranscriptSegment,
} from "./types.js";

describe("CallTranslationWorker TTS normalization", () => {
  it("sends normalized speech text to TTS while keeping caption text unchanged", async () => {
    const sink = new RecordingSink();
    const tts = new RecordingTtsProvider();
    const worker = new CallTranslationWorker({
      asrProvider: new StaticAsrProvider({
        segmentId: "seg_1",
        text: "这个订单多少钱？",
        language: "zh",
      }),
      translationProvider: new StaticTranslationProvider(
        "Order SKU A-120 costs $31.50, call 138-0013-8000.",
      ),
      ttsProvider: tts,
      eventSink: sink,
      nowMs: () => 1000,
    });

    await worker.processAudioFrame(frame("call_1"));
    await worker.endCall("call_1");

    expect(tts.texts).toEqual([
      "Order SKU A one two zero costs 31.50 dollars, call one three eight zero zero one three eight zero zero zero.",
    ]);
    expect(sink.eventsFor("call_1")[1]).toMatchObject({
      type: "translation.final",
      translatedText: "Order SKU A-120 costs $31.50, call 138-0013-8000.",
    });
    expect(sink.eventsFor("call_1")[2]).toMatchObject({
      type: "tts.ready",
      translatedText: "Order SKU A-120 costs $31.50, call 138-0013-8000.",
    });
  });
});

function frame(callId: string): CallAudioFrame {
  return {
    type: "audio.frame",
    sessionId: callId,
    speakerRole: "host",
    sequence: 1,
    timestampMs: 1,
    format: "pcm16",
    sampleRate: 24000,
    data: "AA==",
  };
}

class StaticAsrProvider implements CallAsrProvider {
  constructor(private readonly transcript: TranscriptSegment) {}

  async createCall(_callId: string) {}

  async transcribe(_frame: CallAudioFrame) {
    return this.transcript;
  }

  async flush() {
    return null;
  }

  async closeCall(_callId: string) {}
}

class StaticTranslationProvider implements CallTranslationProvider {
  constructor(private readonly text: string) {}

  async translate() {
    return this.text;
  }
}

class RecordingTtsProvider implements CallTtsProvider {
  readonly texts: string[] = [];

  async synthesize(input: Parameters<CallTtsProvider["synthesize"]>[0])
    : Promise<SynthesizedSpeech> {
    this.texts.push(input.text);
    return {
      provider: "fake-tts",
      model: "fake-voice",
      audio: { format: "pcm16", sampleRate: 24000, data: "AAE=" },
    };
  }
}

class RecordingSink implements CallRoomEventSink {
  private readonly events = new Map<string, CallRoomSubmittedEvent[]>();

  async publish(callId: string, events: CallRoomSubmittedEvent[]) {
    this.events.set(callId, [...this.eventsFor(callId), ...events]);
  }

  eventsFor(callId: string) {
    return this.events.get(callId) ?? [];
  }
}
