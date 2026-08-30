import { describe, expect, it } from "vitest";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import {
  BoundaryAndFlushAsrProvider,
  BoundaryAwareAsrProvider,
  EmptyBoundaryRacingAsrProvider,
  frame,
  LateProtectedIdentifierAsrProvider,
  LateTokenTimedAsrProvider,
  RacingAsrProvider,
  session,
  SwitchingSpeakerProvider,
} from "./speaker-aware-asr-provider.test-support.js";

describe("speaker aware ASR boundary handling", () => {
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

  it("safely splits a delayed final with token timing and retained speaker evidence", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new LateTokenTimedAsrProvider(),
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession({ ...session, asrEndpointMode: "listening" });

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await provider.transcribe({ ...frame, sequence });
    }
    const transcripts = await provider.transcribe({ ...frame, sequence: 5 });

    expect(transcripts).toMatchObject([
      {
        segmentId: "late_timed",
        text: "first",
        turnId: "turn_1",
        speaker: { speakerId: "speaker_1" },
        timing: { startMs: 0, endMs: 480, overlap: false },
      },
      {
        segmentId: "late_timed:speaker:1",
        text: "second",
        turnId: "turn_2",
        speaker: { speakerId: "speaker_2" },
        timing: { startMs: 480, endMs: 960, overlap: false },
      },
    ]);
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: {
        commitMissCount: 1,
        unresolvedCommitMissCount: 0,
        boundaryOutcomeCounts: { token_timing_split: 1 },
      },
    });
  });

  it("keeps a delayed Latin identifier fail-closed across a speaker boundary", async () => {
    const provider = new SpeakerAwareAsrProvider(
      new LateProtectedIdentifierAsrProvider(),
      new SwitchingSpeakerProvider(),
    );
    await provider.createSession({ ...session, asrEndpointMode: "listening" });

    for (let sequence = 1; sequence <= 4; sequence += 1) {
      await provider.transcribe({ ...frame, sequence });
    }
    const transcript = await provider.transcribe({ ...frame, sequence: 5 });

    expect(transcript).toMatchObject({
      segmentId: "late_identifier",
      text: "Qwen3-ASR",
      speaker: { speakerId: "unknown" },
      timing: {
        overlap: true,
        activeSpeakerIds: ["speaker_1", "speaker_2"],
      },
    });
    expect(await provider.diagnostics("sess_1")).toMatchObject({
      speakerTurns: {
        commitMissCount: 1,
        unresolvedCommitMissCount: 1,
        boundaryOutcomeCounts: { unresolved: 1 },
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
