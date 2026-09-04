import { describe, expect, it, vi } from "vitest";
import { SpeakerAwareAsrProvider } from "./speaker-aware-asr-provider.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import {
  BoundaryAwareAsrProvider,
  FakeAsrProvider,
  FakeSpeakerProvider,
  frame,
  session,
  SwitchingSpeakerProvider,
} from "./speaker-aware-asr-provider.test-support.js";

describe("speaker aware ASR diagnostics and identity", () => {
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
