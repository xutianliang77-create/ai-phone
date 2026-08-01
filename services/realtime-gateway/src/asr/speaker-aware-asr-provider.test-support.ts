import type { AudioFrame } from "@translation/contracts";
import type {
  AsrProvider,
  AsrProviderResult,
  AsrSession,
} from "./asr-provider.js";
import type {
  SpeakerAttributionProvider,
  SpeakerSessionInput,
} from "../speaker/speaker-attribution-provider.js";

export const frame: AudioFrame = {
  type: "audio.frame",
  sessionId: "sess_1",
  sequence: 1,
  timestampMs: 1000,
  format: "pcm16",
  sampleRate: 24000,
  data: "AA==",
};

export const session: AsrSession = {
  sessionId: "sess_1",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  speakerAttribution: { mode: "diarization", maxSpeakers: 2 },
};

export class FakeAsrProvider implements AsrProvider {
  async createSession() {}
  async transcribe(): Promise<AsrProviderResult> {
    return {
      segmentId: "seg_1",
      text: "hello",
      language: "en" as const,
      timing: { startMs: 1000, endMs: 1800, source: "client" as const },
    };
  }
  async flush(): Promise<AsrProviderResult> {
    return null;
  }
  async closeSession() {}
  async healthCheck() {
    return true;
  }
}

export class FakeSpeakerProvider implements SpeakerAttributionProvider {
  readonly name = "fake";
  constructor(private readonly failStart = false) {}
  async createSession(_input: SpeakerSessionInput) {
    if (this.failStart) throw new Error("speaker unavailable");
  }
  async pushAudio() {
    return [{ speakerId: "speaker_2", startMs: 900, endMs: 1900 }];
  }
  async flush() {
    return [];
  }
  async closeSession() {}
  async healthCheck() {
    return !this.failStart;
  }
}

export class DelayedAsrProvider extends FakeAsrProvider {
  private calls = 0;
  override async transcribe(): Promise<AsrProviderResult> {
    this.calls += 1;
    return this.calls === 1 ? null : super.transcribe();
  }
}

export class UnknownSpeakerAsrProvider extends FakeAsrProvider {
  private calls = 0;

  constructor(private readonly includeTiming = true) {
    super();
  }

  override async transcribe(): Promise<AsrProviderResult> {
    this.calls += 1;
    const transcript = await super.transcribe();
    if (!transcript || Array.isArray(transcript)) return transcript;
    return {
      ...transcript,
      segmentId: `seg_${this.calls}`,
      speaker: {
        speakerId: "unknown",
        role: "unknown" as const,
        source: "unknown" as const,
      },
      ...(this.includeTiming ? {} : { timing: undefined }),
    };
  }
}

export class OneShotSpeakerProvider extends FakeSpeakerProvider {
  private calls = 0;
  override async pushAudio() {
    this.calls += 1;
    return this.calls === 1
      ? [{ speakerId: "speaker_2", startMs: 900, endMs: 1900 }]
      : [];
  }
}

export class UpdatingSpeakerProvider extends FakeSpeakerProvider {
  private calls = 0;
  override async pushAudio() {
    this.calls += 1;
    return [{
      speakerId: "speaker_2",
      startMs: 900,
      endMs: this.calls === 1 ? 1200 : 1900,
      final: this.calls > 1,
    }];
  }
}

export class BoundaryAwareAsrProvider extends FakeAsrProvider {
  readonly boundaries: number[] = [];

  override async transcribe(): Promise<AsrProviderResult> {
    return null;
  }

  async commitBoundary(
    input: { sessionId: string; boundaryMs: number },
  ): Promise<AsrProviderResult> {
    this.boundaries.push(input.boundaryMs);
    return {
      segmentId: "turn_1",
      text: "first speaker turn",
      language: "en" as const,
      timing: { startMs: 0, endMs: input.boundaryMs, source: "client" as const },
    };
  }
}

export class RacingAsrProvider extends BoundaryAwareAsrProvider {
  private calls = 0;

  override async transcribe(): Promise<AsrProviderResult> {
    this.calls += 1;
    if (this.calls !== 4) return null;
    return {
      segmentId: "regular_endpoint",
      text: "mixed speakers",
      language: "en" as const,
      timing: { startMs: 0, endMs: 960, source: "client" as const },
      endpointReason: "silence" as const,
    };
  }
}

export class BoundaryAndFlushAsrProvider extends BoundaryAwareAsrProvider {
  override async flush(): Promise<AsrProviderResult> {
    return {
      segmentId: "turn_2_tail",
      text: "second speaker turn",
      language: "en" as const,
      timing: { startMs: 480, endMs: 960, source: "client" as const },
    };
  }
}

export class EmptyBoundaryRacingAsrProvider extends RacingAsrProvider {
  override async commitBoundary(
    input: { sessionId: string; boundaryMs: number },
  ): Promise<AsrProviderResult> {
    this.boundaries.push(input.boundaryMs);
    return null;
  }
}

export class SwitchingSpeakerProvider extends FakeSpeakerProvider {
  private calls = 0;

  override async pushAudio() {
    this.calls += 1;
    if (this.calls === 1) return [speakerSpan("speaker_1", 0, 240)];
    if (this.calls === 2) return [speakerSpan("speaker_1", 0, 480)];
    if (this.calls === 3) return [speakerSpan("speaker_2", 480, 720)];
    return [speakerSpan("speaker_2", 480, 960)];
  }
}

export class ReturningSpeakerProvider extends FakeSpeakerProvider {
  private calls = 0;

  override async pushAudio() {
    this.calls += 1;
    if (this.calls === 1) return [speakerSpan("speaker_1", 0, 240)];
    if (this.calls === 2) return [speakerSpan("speaker_1", 0, 480)];
    if (this.calls === 3) return [speakerSpan("speaker_2", 480, 720)];
    if (this.calls === 4) return [speakerSpan("speaker_2", 480, 960)];
    if (this.calls === 5) return [speakerSpan("speaker_1", 960, 1200)];
    return [speakerSpan("speaker_1", 960, 1440)];
  }
}

function speakerSpan(speakerId: string, startMs: number, endMs: number) {
  return { speakerId, startMs, endMs, confidence: 0.9, final: false };
}
