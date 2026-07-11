import { describe, expect, it } from "vitest";
import { CallTranslationWorker } from "./call-translation-worker.js";
import type { CallAsrProvider, CallRoomEventSink } from "./types.js";
import type { CallRoomSubmittedEvent } from "@translation/contracts";

describe("CallTranslationWorker diagnostics", () => {
  it("publishes structured ASR status instead of throwing on frame errors", async () => {
    const sink = new RecordingSink();
    const worker = new CallTranslationWorker({
      asrProvider: failingAsrProvider(),
      translationProvider: { translate: async () => "unused" },
      eventSink: sink,
      nowMs: () => 1000,
    });

    await worker.processAudioFrame({
      type: "audio.frame",
      sessionId: "call_1",
      speakerRole: "host",
      sequence: 7,
      timestampMs: 1,
      format: "pcm16",
      sampleRate: 24000,
      data: "AA==",
    });

    expect(sink.eventsFor("call_1")).toMatchObject([{
      type: "worker.status",
      segmentId: "asr-failed-host-7",
      text: "ASR 识别失败，已继续监听",
      stage: "asr",
      retryable: true,
    }]);
  });
});

function failingAsrProvider(): CallAsrProvider {
  return {
    createCall: async () => undefined,
    transcribe: async () => { throw new Error("ASR network connection failed"); },
    flush: async () => null,
    closeCall: async () => undefined,
  };
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
