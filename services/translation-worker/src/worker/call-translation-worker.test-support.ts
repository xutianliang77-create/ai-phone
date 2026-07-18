import type { CallRoomSubmittedEvent, CallRoomTranslationLanguage } from "@translation/contracts";
import { CallTranslationWorker } from "./call-translation-worker.js";
import type { CallTranscriptRefiner } from "./call-transcript-refiner.js";
import type {
  CallAsrProvider,
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallRoomEventSink,
  CallTtsAudioSink,
  CallTtsProvider,
  CallTranslationProvider,
  SynthesizedSpeech,
  TranscriptSegment,
} from "./types.js";

export function newWorker(
  asr: CallAsrProvider,
  sink: RecordingSink,
  ttsProvider?: CallTtsProvider,
  ttsAudioSink?: CallTtsAudioSink,
  translationProvider: CallTranslationProvider = new FakeTranslationProvider(),
  transcriptRefiner?: CallTranscriptRefiner,
  endDrainGraceMs = 0,
) {
  return new CallTranslationWorker({
    asrProvider: asr,
    translationProvider,
    ttsProvider,
    ttsAudioSink,
    eventSink: sink,
    transcriptRefiner,
    endDrainGraceMs,
    nowMs: () => 1000,
  });
}

export function frame(
  callId: string,
  speakerRole: CallAudioSpeakerRole,
  sequence = 1,
): CallAudioFrame {
  return {
    type: "audio.frame",
    sessionId: callId,
    speakerRole,
    sequence,
    timestampMs: 1,
    format: "pcm16",
    sampleRate: 24000,
    data: "AA==",
  };
}

export class FakeAsrProvider implements CallAsrProvider {
  constructor(
    private readonly transcript: TranscriptSegment | null,
    private readonly flushed: TranscriptSegment | null = null,
  ) {}

  async createCall(_callId: string) {}

  async transcribe(_frame: CallAudioFrame) {
    return this.transcript;
  }

  async flush(_callId: string, _speakerRole: CallAudioSpeakerRole) {
    return this.flushed;
  }

  async closeCall(_callId: string) {}
}

class FakeTranslationProvider implements CallTranslationProvider {
  async translate(input: { targetLanguage: CallRoomTranslationLanguage }) {
    return input.targetLanguage === "zh" ? "明天见" : "hello";
  }
}

export class FailingTranslationProvider implements CallTranslationProvider {
  async translate(): Promise<string> {
    throw new Error("chatty provider reply");
  }
}

export class FakeTtsProvider implements CallTtsProvider {
  async synthesize(): Promise<SynthesizedSpeech> {
    return {
      provider: "fake-tts",
      model: "fake-voice",
      voiceMode: "personal_clone",
      voiceProfileId: "my_voice",
      firstAudioMs: 120,
      audioDurationMs: 900,
      audio: {
        format: "pcm16",
        sampleRate: 24000,
        data: "AAE=",
      },
    };
  }
}

export class FailingTtsProvider implements CallTtsProvider {
  async synthesize(): Promise<SynthesizedSpeech> {
    throw new Error("tts service returned malformed audio");
  }
}

export class RecordingTtsAudioSink implements CallTtsAudioSink {
  readonly played: Parameters<CallTtsAudioSink["play"]>[0][] = [];

  async play(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    this.played.push(input);
  }
}

export class BlockingTtsAudioSink implements CallTtsAudioSink {
  readonly played: Parameters<CallTtsAudioSink["play"]>[0][] = [];
  readonly playbackStarted: Promise<void>;
  private resolvePlaybackStarted!: () => void;
  private readonly playbackReleased: Promise<void>;
  private resolvePlaybackReleased!: () => void;

  constructor() {
    this.playbackStarted = new Promise((resolve) => {
      this.resolvePlaybackStarted = resolve;
    });
    this.playbackReleased = new Promise((resolve) => {
      this.resolvePlaybackReleased = resolve;
    });
  }

  async play(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    this.played.push(input);
    this.resolvePlaybackStarted();
    await this.playbackReleased;
  }

  releasePlayback() {
    this.resolvePlaybackReleased();
  }
}

export class RecordingSink implements CallRoomEventSink {
  private readonly events = new Map<string, CallRoomSubmittedEvent[]>();

  async publish(callId: string, events: CallRoomSubmittedEvent[]) {
    this.events.set(callId, [...this.eventsFor(callId), ...events]);
  }

  eventsFor(callId: string) {
    return this.events.get(callId) ?? [];
  }
}
