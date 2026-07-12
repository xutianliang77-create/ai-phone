import { describe, expect, it } from "vitest";
import type { AudioFrame } from "@translation/contracts";
import type { AsrProvider, AsrSession } from "./asr-provider.js";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import type {
  SpeakerAttributionProvider,
  SpeakerSessionInput,
} from "../speaker/speaker-attribution-provider.js";

const frame: AudioFrame = {
  type: "audio.frame",
  sessionId: "sess_1",
  sequence: 1,
  timestampMs: 1000,
  format: "pcm16",
  sampleRate: 24000,
  data: "AA==",
};

const session: AsrSession = {
  sessionId: "sess_1",
  sourceLanguage: "auto",
  targetLanguage: "zh",
  speakerAttribution: { mode: "diarization", maxSpeakers: 2 },
};

describe("speaker aware asr provider", () => {
  it("aligns diarization spans without changing ASR text", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new FakeAsrProvider(),
      new FakeSpeakerProvider(),
    );
    await provider.createSession(session);
    const transcript = await provider.transcribe(frame);

    expect(transcript).toMatchObject({
      text: "hello",
      speaker: {
        speakerId: "speaker_2",
        role: "speaker",
        source: "diarization",
      },
    });
  });

  it("keeps ASR available when the speaker service cannot start", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new FakeAsrProvider(),
      new FakeSpeakerProvider(true),
    );
    await provider.createSession(session);

    const transcript = await provider.transcribe(frame);

    expect(transcript).toMatchObject({ text: "hello" });
    expect(transcript).not.toHaveProperty("speaker");
  });

  it("retains speaker spans produced before ASR emits a transcript", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new DelayedAsrProvider(),
      new OneShotSpeakerProvider(),
    );
    await provider.createSession(session);

    expect(await provider.transcribe(frame)).toBeNull();
    const transcript = await provider.transcribe({ ...frame, sequence: 2 });

    expect(transcript).toMatchObject({
      text: "hello",
      speaker: { speakerId: "speaker_2" },
    });
  });

  it("replaces a provisional speaker span with its final boundary", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new DelayedAsrProvider(),
      new UpdatingSpeakerProvider(),
    );
    await provider.createSession(session);

    expect(await provider.transcribe(frame)).toBeNull();
    const transcript = await provider.transcribe({ ...frame, sequence: 2 });

    expect(transcript).toMatchObject({
      speaker: { speakerId: "speaker_2" },
    });
  });

  it("commits ASR audio when a new speaker boundary becomes stable", async () => {
    const asr = new BoundaryAwareAsrProvider();
    const provider = new SpeakerAwareAsrProvider(
      asr,
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession(session);

    expect(await provider.transcribe({ ...frame, sequence: 1 })).toBeNull();
    expect(await provider.transcribe({ ...frame, sequence: 2 })).toBeNull();
    expect(await provider.transcribe({ ...frame, sequence: 3 })).toBeNull();
    const transcript = await provider.transcribe({ ...frame, sequence: 4 });

    expect(asr.boundaries).toEqual([480]);
    expect(transcript).toMatchObject({
      text: "first speaker turn",
      turnId: "turn_1",
      revision: 0,
      speaker: { speakerId: "speaker_1" },
      timing: { startMs: 0, endMs: 480 },
    });
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: {
        confirmedBoundaryCount: 1,
        commitHitCount: 1,
        commitMissCount: 0,
        commitErrorCount: 0,
        averageConfirmationLatencyMs: 480,
        committedAudioMs: 480,
      },
    });
  });

  it("suppresses a regular endpoint result when boundary audio replaces it", async () => {
    const asr = new RacingAsrProvider();
    const provider = new SpeakerAwareAsrProvider(
      asr,
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession(session);

    await provider.transcribe({ ...frame, sequence: 1 });
    await provider.transcribe({ ...frame, sequence: 2 });
    await provider.transcribe({ ...frame, sequence: 3 });
    const transcript = await provider.transcribe({ ...frame, sequence: 4 });

    expect(transcript).toMatchObject({
      segmentId: "turn_1",
      text: "first speaker turn",
      speaker: { speakerId: "speaker_1" },
    });
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: { endpointRaceCount: 1, commitHitCount: 1 },
    });
  });

  it("keeps the regular result but reports the race when boundary commit is empty", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new EmptyBoundaryRacingAsrProvider(),
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession(session);

    await provider.transcribe({ ...frame, sequence: 1 });
    await provider.transcribe({ ...frame, sequence: 2 });
    await provider.transcribe({ ...frame, sequence: 3 });
    const transcript = await provider.transcribe({ ...frame, sequence: 4 });

    expect(transcript).toMatchObject({
      segmentId: "regular_endpoint",
      text: "mixed speakers",
      turnId: "turn_1",
    });
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: {
        endpointRaceCount: 1,
        commitHitCount: 0,
        commitMissCount: 1,
      },
    });
  });

  it("advances the stable turn only after a confirmed speaker boundary", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new BoundaryAndFlushAsrProvider(),
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession(session);

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await provider.transcribe({ ...frame, sequence });
    }
    const transcript = await provider.flush("sess_1");

    expect(transcript).toMatchObject({
      segmentId: "turn_2_tail",
      turnId: "turn_2",
      revision: 0,
      text: "second speaker turn",
      speaker: { speakerId: "speaker_2" },
    });
  });
});

class FakeAsrProvider implements AsrProvider {
  async createSession() {}
  async transcribe() {
    return {
      segmentId: "seg_1",
      text: "hello",
      language: "en" as const,
      timing: { startMs: 1000, endMs: 1800, source: "client" as const },
    };
  }
  async flush() {
    return null;
  }
  async closeSession() {}
  async healthCheck() {
    return true;
  }
}

class FakeSpeakerProvider implements SpeakerAttributionProvider {
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

class DelayedAsrProvider extends FakeAsrProvider {
  private calls = 0;
  override async transcribe() {
    this.calls += 1;
    return this.calls === 1 ? null : super.transcribe();
  }
}

class OneShotSpeakerProvider extends FakeSpeakerProvider {
  private calls = 0;
  override async pushAudio() {
    this.calls += 1;
    return this.calls === 1
      ? [{ speakerId: "speaker_2", startMs: 900, endMs: 1900 }]
      : [];
  }
}

class UpdatingSpeakerProvider extends FakeSpeakerProvider {
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

class BoundaryAwareAsrProvider extends FakeAsrProvider {
  readonly boundaries: number[] = [];

  override async transcribe() {
    return null;
  }

  async commitBoundary(input: { sessionId: string; boundaryMs: number }) {
    this.boundaries.push(input.boundaryMs);
    return {
      segmentId: "turn_1",
      text: "first speaker turn",
      language: "en" as const,
      timing: { startMs: 0, endMs: input.boundaryMs, source: "client" as const },
    };
  }
}

class RacingAsrProvider extends BoundaryAwareAsrProvider {
  private calls = 0;

  override async transcribe() {
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

class BoundaryAndFlushAsrProvider extends BoundaryAwareAsrProvider {
  override async flush() {
    return {
      segmentId: "turn_2_tail",
      text: "second speaker turn",
      language: "en" as const,
      timing: { startMs: 480, endMs: 960, source: "client" as const },
    };
  }
}

class EmptyBoundaryRacingAsrProvider extends RacingAsrProvider {
  override async commitBoundary(input: { sessionId: string; boundaryMs: number }) {
    this.boundaries.push(input.boundaryMs);
    return null;
  }
}

class SwitchingSpeakerProvider extends FakeSpeakerProvider {
  private calls = 0;

  override async pushAudio() {
    this.calls += 1;
    if (this.calls === 1) return [speakerSpan("speaker_1", 0, 240)];
    if (this.calls === 2) return [speakerSpan("speaker_1", 0, 480)];
    if (this.calls === 3) return [speakerSpan("speaker_2", 480, 720)];
    return [speakerSpan("speaker_2", 480, 960)];
  }
}

function speakerSpan(speakerId: string, startMs: number, endMs: number) {
  return { speakerId, startMs, endMs, confidence: 0.9, final: false };
}
