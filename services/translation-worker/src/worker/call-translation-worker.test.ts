import { describe, expect, it } from "vitest";
import {
  BlockingTtsAudioSink,
  FailingTranslationProvider,
  FailingTtsProvider,
  FakeAsrProvider,
  FakeTtsProvider,
  RecordingSink,
  RecordingTtsAudioSink,
  frame,
  newWorker,
} from "./call-translation-worker.test-support.js";
import type {
  CallTtsProvider,
  SynthesizedSpeech,
  TtsVoiceConfig,
} from "./types.js";

describe("CallTranslationWorker", () => {
  it("publishes transcript and reverse translation for audio frames", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "你好",
      language: "zh",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.startCall("call_1");
    await worker.processAudioFrame(frame("call_1", "host"));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "worker.status",
      "transcript.final",
      "translation.final",
    ]);
    expect(sink.eventsFor("call_1")[1]).toMatchObject({
      segmentId: "seg_1",
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      sourceText: "你好",
    });
    expect(sink.eventsFor("call_1")[2]).toMatchObject({
      translatedText: "hello",
      text: "hello",
    });
  });

  it("flushes tail speech through the same translation path", async () => {
    const asr = new FakeAsrProvider(null, {
      segmentId: "flush_1",
      text: "see you tomorrow",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_1", "guest"));
    await worker.flushSpeaker("call_1", "guest");

    expect(sink.eventsFor("call_1")).toMatchObject([
      {
        type: "transcript.final",
        segmentId: "flush_1",
        sourceLanguage: "en",
        targetLanguage: "zh",
        sourceText: "see you tomorrow",
      },
      {
        type: "translation.final",
        segmentId: "flush_1",
        translatedText: "明天见",
      },
    ]);
  });

  it("does not republish duplicate final segments", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink);

    await worker.processAudioFrame(frame("call_1", "guest", 1));
    await worker.processAudioFrame(frame("call_1", "guest", 2));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
    ]);
  });

  it("keeps transcript captions when translation fails", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "再读一读。",
      language: "zh",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink, undefined, undefined, new FailingTranslationProvider());

    await worker.processAudioFrame(frame("call_1", "host"));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "worker.status",
    ]);
    expect(sink.eventsFor("call_1")[0]).toMatchObject({
      segmentId: "seg_1",
      sourceText: "再读一读。",
    });
    expect(sink.eventsFor("call_1")[1]).toMatchObject({
      segmentId: "translation-failed-seg_1",
      text: "翻译失败，已保留原文字幕",
      stage: "translation",
      retryable: true,
    });
  });

  it("publishes tts readiness when a TTS provider is configured", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink, new FakeTtsProvider());

    await worker.processAudioFrame(frame("call_1", "guest"));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "tts.ready",
    ]);
    expect(sink.eventsFor("call_1")[2]).toMatchObject({
      segmentId: "seg_1",
      speakerRole: "guest",
      targetLanguage: "zh",
      text: "明天见",
      provider: "fake-tts",
      model: "fake-voice",
      voiceMode: "personal_clone",
      voiceProfileId: "my_voice",
      firstAudioMs: 120,
      audioDurationMs: 900,
    });
  });

  it("passes the configured caller voice profile to TTS synthesis", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    const sink = new RecordingSink();
    const tts = new RecordingVoiceTtsProvider();
    const worker = newWorker(asr, sink, tts);
    worker.setTtsVoice({
      mode: "personal_clone",
      voiceProfileId: "voice-profile-1",
      referenceAudioId: "voice-profile-1",
    });

    await worker.processAudioFrame(frame("call_1", "guest"));

    expect(tts.requests).toMatchObject([
      {
        text: "明天见",
        language: "zh",
        speakerRole: "guest",
        segmentId: "seg_1",
        voice: {
          mode: "personal_clone",
          voiceProfileId: "voice-profile-1",
          referenceAudioId: "voice-profile-1",
        },
      },
    ]);
  });

  it("keeps captions and translation when speech synthesis fails", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink, new FailingTtsProvider());

    await worker.processAudioFrame(frame("call_1", "guest"));

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "worker.status",
    ]);
    expect(sink.eventsFor("call_1")[2]).toMatchObject({
      segmentId: "tts-synthesis-failed-seg_1",
      text: "TTS 合成失败，已继续显示字幕",
      stage: "tts",
      retryable: true,
    });
  });

  it("plays synthesized speech to the opposite speaker role", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "你好",
      language: "zh",
    });
    const sink = new RecordingSink();
    const audioSink = new RecordingTtsAudioSink();
    const worker = newWorker(asr, sink, new FakeTtsProvider(), audioSink);

    await worker.processAudioFrame(frame("call_1", "host"));
    await worker.endCall("call_1");

    expect(audioSink.played).toHaveLength(1);
    expect(audioSink.played[0]).toMatchObject({
      callId: "call_1",
      segmentId: "seg_1",
      playbackId: "pb_seg_1_1",
      generation: 1,
      sourceSpeakerRole: "host",
      targetSpeakerRole: "guest",
      language: "en",
      speech: {
        provider: "fake-tts",
        model: "fake-voice",
        audio: {
          format: "pcm16",
          sampleRate: 24000,
          data: "AAE=",
        },
      },
    });
  });

  it("publishes captions before waiting for synthesized speech playback", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "你好",
      language: "zh",
    });
    const sink = new RecordingSink();
    const audioSink = new BlockingTtsAudioSink();
    const worker = newWorker(asr, sink, new FakeTtsProvider(), audioSink);

    const pending = worker.processAudioFrame(frame("call_1", "host"));
    await audioSink.playbackStarted;

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "tts.ready",
      "playback.queued",
      "playback.started",
    ]);

    audioSink.releasePlayback();
    await pending;
    await worker.endCall("call_1");
    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "tts.ready",
      "playback.queued",
      "playback.started",
      "playback.ended",
      "worker.status",
    ]);
  });

  it("keeps captions when synthesized speech playback fails", async () => {
    const asr = new FakeAsrProvider({
      segmentId: "seg_1",
      text: "hello",
      language: "en",
    });
    const sink = new RecordingSink();
    const worker = newWorker(asr, sink, new FakeTtsProvider(), {
      async play() {
        throw new Error("speaker unavailable");
      },
    });

    await worker.processAudioFrame(frame("call_1", "guest"));
    await worker.endCall("call_1");

    expect(sink.eventsFor("call_1").map((event) => event.type)).toEqual([
      "transcript.final",
      "translation.final",
      "tts.ready",
      "playback.queued",
      "playback.started",
      "playback.failed",
      "worker.status",
      "worker.status",
    ]);
    expect(sink.eventsFor("call_1").find(
      (event) => event.segmentId === "tts-playback-failed-seg_1",
    )).toMatchObject({
      segmentId: "tts-playback-failed-seg_1",
      text: "TTS 播放失败，已继续显示字幕",
      provider: "fake-tts",
      model: "fake-voice",
      stage: "tts",
      retryable: true,
    });
  });
});

class RecordingVoiceTtsProvider implements CallTtsProvider {
  readonly requests: Array<{
    text: string;
    language: string;
    speakerRole: string;
    segmentId: string;
    voice?: TtsVoiceConfig;
  }> = [];

  async synthesize(
    input: Parameters<CallTtsProvider["synthesize"]>[0],
  ): Promise<SynthesizedSpeech> {
    this.requests.push(input);
    return {
      provider: "fake-tts",
      model: "fake-voice",
      voiceMode: input.voice?.mode,
      voiceProfileId: input.voice?.voiceProfileId,
      audio: {
        format: "pcm16",
        sampleRate: 24000,
        data: "AAE=",
      },
    };
  }
}
