import { describe, expect, it, vi } from "vitest";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
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
  session,
  SwitchingSpeakerProvider,
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
