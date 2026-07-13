import { describe, expect, it } from "vitest";
import {
  BlockingTtsAudioSink,
  FakeTtsProvider,
  RecordingSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  TranscriptSegment,
} from "./types.js";

describe("CallTranslationWorker quality pipeline", () => {
  it("merges max-duration continuation before translation", async () => {
    const asr = new SequenceAsrProvider([
      segment("seg_long_1", "今天下午三点我们讨论产品计划，", "max_duration"),
      segment("seg_long_2", "确认负责人和截止日期。", "silence"),
    ]);
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_long", "host", 1));
    expect(sink.eventsFor("call_long")).toEqual([]);
    await worker.processAudioFrame(frame("call_long", "host", 2));

    expect(sink.eventsFor("call_long")[0]).toMatchObject({
      type: "transcript.final",
      sourceText: "今天下午三点我们讨论产品计划，确认负责人和截止日期。",
    });
  });

  it("keeps mixed-language terms inside one participant turn", async () => {
    const asr = new SequenceAsrProvider([
      segment("mixed_1", "请检查 LiveKit API，", "max_duration"),
      segment("mixed_2", "然后部署到服务器。", "silence"),
    ]);
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_mixed", "host", 1));
    await worker.processAudioFrame(frame("call_mixed", "host", 2));

    expect(sink.eventsFor("call_mixed")[0]).toMatchObject({
      sourceLanguage: "zh",
      sourceText: "请检查 LiveKit API，然后部署到服务器。",
    });
  });

  it("flushes the previous participant turn before the next speaker", async () => {
    const asr = new RoleAsrProvider({
      host: segment("host_1", "我先说明第一项，", "max_duration"),
      guest: {
        segmentId: "guest_1",
        text: "I will answer now.",
        language: "en",
        endpointReason: "silence",
      },
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_turn", "host", 1));
    await worker.processAudioFrame(frame("call_turn", "guest", 2));

    expect(sink.eventsFor("call_turn")
      .filter((event) => event.type === "transcript.final")
      .map((event) => event.speakerRole)).toEqual(["host", "guest"]);
  });

  it("drops filler-only ASR fragments but keeps meaningful short speech", async () => {
    const asr = new SequenceAsrProvider([
      segment("filler", "嗯嗯。"),
      segment("short", "你好。"),
    ]);
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_short", "host", 1));
    await worker.processAudioFrame(frame("call_short", "host", 2));

    expect(sink.eventsFor("call_short")
      .filter((event) => event.type === "transcript.final")
      .map((event) => event.sourceText)).toEqual(["你好。"]);
  });

  it("keeps later captions moving while TTS playback stays ordered", async () => {
    const asr = new SequenceAsrProvider([
      segment("tts_1", "第一句。"),
      segment("tts_2", "第二句。"),
    ]);
    const sink = new RecordingSink();
    const audioSink = new BlockingTtsAudioSink();
    const worker = newWorker(asr, sink, new FakeTtsProvider(), audioSink);

    await worker.processAudioFrame(frame("call_tts", "host", 1));
    await audioSink.playbackStarted;
    await worker.processAudioFrame(frame("call_tts", "host", 2));

    expect(sink.eventsFor("call_tts")
      .filter((event) => event.type === "translation.final")).toHaveLength(2);
    expect(audioSink.played).toHaveLength(1);
    audioSink.releasePlayback();
    await worker.endCall("call_tts");
    expect(audioSink.played.map((item) => item.segmentId)).toEqual(["tts_1", "tts_2"]);
  });

  it("drops translated speech recaptured by the target participant", async () => {
    const asr = new SequenceAsrProvider([
      segment("source_1", "你能看到我的屏幕吗？", "silence"),
      {
        segmentId: "echo_1",
        text: "Can you see my screen?",
        language: "en",
        endpointReason: "silence",
      },
    ]);
    const sink = new RecordingSink();
    const audioSink = new BlockingTtsAudioSink();
    const worker = newWorker(
      asr,
      sink,
      new FakeTtsProvider(),
      audioSink,
      { async translate() { return "Can you see my screen?"; } },
    );

    await worker.processAudioFrame(frame("call_echo", "host", 1));
    await audioSink.playbackStarted;
    await worker.processAudioFrame(frame("call_echo", "guest", 2));

    expect(sink.eventsFor("call_echo")
      .filter((event) => event.type === "transcript.final")
      .map((event) => event.segmentId)).toEqual(["source_1"]);
    audioSink.releasePlayback();
    await worker.endCall("call_echo");
  });

  it("releases the local turn buffer even when remote ASR flush fails", async () => {
    const asr = new SequenceAsrProvider([
      segment("tail_1", "最后一句仍需保存，", "max_duration"),
    ], true);
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_tail", "host", 1));
    await worker.flushSpeaker("call_tail", "host");

    expect(sink.eventsFor("call_tail")
      .find((event) => event.type === "transcript.final")).toMatchObject({
      sourceText: "最后一句仍需保存，",
    });
  });
});

function segment(
  segmentId: string,
  text: string,
  endpointReason?: TranscriptSegment["endpointReason"],
): TranscriptSegment {
  return { segmentId, text, language: "zh", ...(endpointReason ? { endpointReason } : {}) };
}

class SequenceAsrProvider implements CallAsrProvider {
  constructor(
    private readonly transcripts: TranscriptSegment[],
    private readonly failFlush = false,
  ) {}
  async createCall(_callId: string) {}
  async transcribe(_frame: CallAudioFrame) {
    return this.transcripts.shift() ?? null;
  }
  async flush(_callId: string, _speakerRole: CallAudioSpeakerRole) {
    if (this.failFlush) throw new Error("ASR flush unavailable");
    return null;
  }
  async closeCall(_callId: string) {}
}

class RoleAsrProvider implements CallAsrProvider {
  constructor(private readonly transcripts: Record<CallAudioSpeakerRole, TranscriptSegment>) {}
  async createCall(_callId: string) {}
  async transcribe(frame: CallAudioFrame) {
    return this.transcripts[frame.speakerRole];
  }
  async flush(_callId: string, _speakerRole: CallAudioSpeakerRole) {
    return null;
  }
  async closeCall(_callId: string) {}
}
