import { describe, expect, it, vi } from "vitest";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import {
  BoundaryAndFlushAsrProvider,
  BoundaryAwareAsrProvider,
  DelayedAsrProvider,
  EmptyBoundaryRacingAsrProvider,
  FakeAsrProvider,
  FakeSpeakerProvider,
  frame,
  OneShotSpeakerProvider,
  RacingAsrProvider,
  ReturningSpeakerProvider,
  session,
  SwitchingSpeakerProvider,
  UnknownSpeakerAsrProvider,
  UpdatingSpeakerProvider,
} from "./speaker-aware-asr-provider.test-support.js";

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

  it("replaces an explicit unknown ASR speaker with diarization evidence", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new UnknownSpeakerAsrProvider(),
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

  it("reuses the original anonymous speaker when that speaker returns", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new UnknownSpeakerAsrProvider(false),
      new ReturningSpeakerProvider(),
    );
    await provider.createSession(session);

    const observed = [];
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      observed.push(await provider.transcribe({ ...frame, sequence }));
    }

    expect(observed[1]).toMatchObject({
      speaker: { speakerId: "speaker_1" },
    });
    expect(observed[3]).toMatchObject({
      speaker: { speakerId: "speaker_2" },
    });
    expect(observed[5]).toMatchObject({
      speaker: { speakerId: "speaker_1" },
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

  it("falls back to the stable turn speaker when no span overlaps the ASR window", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new OutOfWindowAsrProvider(),
      new ConfidentSpeakerProvider(),
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
      speaker: {
        speakerId: "unknown",
        role: "unknown",
        source: "unknown",
      },
      timing: {
        overlap: true,
        activeSpeakerIds: ["speaker_1", "speaker_2"],
      },
    });
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: {
        endpointRaceCount: 1,
        commitHitCount: 0,
        commitMissCount: 1,
      },
    });
  });

  it("does not assign a boundary commit that still crosses both speakers", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new CrossingBoundaryAsrProvider(),
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession(session);

    for (let sequence = 1; sequence <= 3; sequence += 1) {
      await provider.transcribe({ ...frame, sequence });
    }
    const transcript = await provider.transcribe({ ...frame, sequence: 4 });

    expect(transcript).toMatchObject({
      segmentId: "mixed_boundary",
      text: "first and second speaker",
      speaker: {
        speakerId: "unknown",
        role: "unknown",
        source: "unknown",
      },
      timing: {
        startMs: 0,
        endMs: 960,
        overlap: true,
        activeSpeakerIds: ["speaker_1", "speaker_2"],
      },
    });
  });

  it("keeps the boundary guard for a transcript emitted on a later frame", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new LateCrossingAsrProvider(),
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession(session);

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await provider.transcribe({ ...frame, sequence });
    }
    const transcript = await provider.transcribe({ ...frame, sequence: 5 });

    expect(transcript).toMatchObject({
      segmentId: "late_mixed",
      text: "late mixed speakers",
      speaker: { speakerId: "unknown" },
      timing: {
        overlap: true,
        activeSpeakerIds: ["speaker_1", "speaker_2"],
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

  it("captures raw speaker spans and confirmed coordinator decisions without audio", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const log = vi.spyOn(realtimeLogger, "info")
      .mockImplementation(() => undefined as never);
    try {
      const provider = new SpeakerAwareAsrProvider(
        new BoundaryAwareAsrProvider(),
        new SwitchingSpeakerProvider(),
        undefined,
        undefined,
        {
          enabled: true,
          maxSessions: 1,
          maxDurationMs: 120_000,
          maxRecords: 1200,
        },
      );
      await provider.createSession({
        ...session,
        asrEndpointMode: "listening",
      });

      for (let sequence = 1; sequence <= 4; sequence += 1) {
        vi.setSystemTime(1000 + sequence * 100);
        await provider.transcribe({ ...frame, sequence });
      }

      const captures = log.mock.calls.filter((call) =>
        call[1] === "Bounded speaker span diagnostic capture"
      );
      expect(captures).toHaveLength(4);
      expect(captures[3][0]).toMatchObject({
        sessionId: "sess_1",
        sequence: 4,
        rawSpeakerIds: ["speaker_2"],
        rawSpans: [{
          speakerId: "speaker_2",
          startMs: 480,
          endMs: 960,
          confidence: 0.9,
          overlap: false,
          final: false,
        }],
        coordinatorCurrentSpeakerId: "speaker_2",
        coordinatorBoundary: {
          previousSpeakerId: "speaker_1",
          nextSpeakerId: "speaker_2",
          boundaryMs: 480,
        },
      });
      expect(captures[3][0]).not.toHaveProperty("data");
      expect(captures[3][0]).not.toHaveProperty("text");
    } finally {
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it("stops span capture at the duration gate and never admits a second session", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const log = vi.spyOn(realtimeLogger, "info")
      .mockImplementation(() => undefined as never);
    try {
      const provider = new SpeakerAwareAsrProvider(
        new FakeAsrProvider(),
        new FakeSpeakerProvider(),
        undefined,
        undefined,
        {
          enabled: true,
          maxSessions: 1,
          maxDurationMs: 100,
          maxRecords: 10,
        },
      );
      await provider.createSession({
        ...session,
        asrEndpointMode: "listening",
      });
      await provider.transcribe(frame);
      vi.setSystemTime(1101);
      await provider.transcribe({ ...frame, sequence: 2 });
      await provider.closeSession("sess_1");

      await provider.createSession({
        ...session,
        sessionId: "sess_2",
        asrEndpointMode: "listening",
      });
      vi.setSystemTime(1200);
      await provider.transcribe({
        ...frame,
        sessionId: "sess_2",
        sequence: 1,
      });

      const captures = log.mock.calls.filter((call) =>
        call[1] === "Bounded speaker span diagnostic capture"
      );
      expect(captures).toHaveLength(1);
      expect(captures[0][0]).toMatchObject({
        sessionId: "sess_1",
        sequence: 1,
      });
    } finally {
      log.mockRestore();
      vi.useRealTimers();
    }
  });

  it("replaces a diarized label with an authorized voice identity", async () => {
    const match = vi.fn().mockResolvedValue({
      speakerId: "identity_1",
      role: "speaker" as const,
      source: "voice_identity" as const,
      displayName: "张经理",
      confidence: 0.93,
    });
    const provider = new SpeakerAwareAsrProvider(
      new FakeAsrProvider(),
      new FakeSpeakerProvider(),
      undefined,
      { match },
    );
    await provider.createSession({
      ...session,
      userId: "user_1",
      speakerAttribution: {
        mode: "diarization",
        maxSpeakers: 2,
        allowVoiceIdentity: true,
      },
    });
    const audioFrame = {
      ...frame,
      data: Buffer.alloc(24000 * 2 * 2).toString("base64"),
    };

    const first = await provider.transcribe(audioFrame);
    const second = await provider.transcribe({
      ...audioFrame,
      sequence: 2,
      timestampMs: 3000,
    });

    expect(first).toMatchObject({
      text: "hello",
      speaker: {
        speakerId: "identity_1",
        source: "voice_identity",
        displayName: "张经理",
        confidence: 0.93,
      },
    });
    expect(second).toMatchObject({ speaker: { speakerId: "identity_1" } });
    expect(match).toHaveBeenCalledOnce();
    expect(match.mock.calls[0][0].userId).toBe("user_1");
    expect(Buffer.from(match.mock.calls[0][0].audioBase64, "base64")
      .subarray(0, 4).toString("ascii")).toBe("RIFF");
  });
});

class OutOfWindowAsrProvider extends FakeAsrProvider {
  override async transcribe() {
    const transcript = await super.transcribe();
    if (!transcript || Array.isArray(transcript)) return transcript;
    return {
      ...transcript,
      timing: { startMs: 3000, endMs: 4000, source: "client" as const },
    };
  }
}

class ConfidentSpeakerProvider extends FakeSpeakerProvider {
  override async pushAudio() {
    return [{
      speakerId: "speaker_2",
      startMs: 900,
      endMs: 1900,
      confidence: 0.9,
    }];
  }
}

class CrossingBoundaryAsrProvider extends BoundaryAwareAsrProvider {
  override async commitBoundary(
    input: { sessionId: string; boundaryMs: number },
  ) {
    this.boundaries.push(input.boundaryMs);
    return {
      segmentId: "mixed_boundary",
      text: "first and second speaker",
      language: "en" as const,
      timing: { startMs: 0, endMs: 960, source: "client" as const },
    };
  }
}

class LateCrossingAsrProvider extends BoundaryAwareAsrProvider {
  private calls = 0;

  override async transcribe() {
    this.calls += 1;
    if (this.calls !== 5) return null;
    return {
      segmentId: "late_mixed",
      text: "late mixed speakers",
      language: "en" as const,
      timing: { startMs: 0, endMs: 960, source: "client" as const },
    };
  }

  override async commitBoundary(
    input: { sessionId: string; boundaryMs: number },
  ) {
    this.boundaries.push(input.boundaryMs);
    return null;
  }
}
