import { initializeLogger, voice } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { describe, expect, it, vi } from "vitest";
import {
  LiveKitTargetAudioOutput,
} from "./livekit-target-audio-output.js";
import {
  configureVoiceAgentSessionAudio,
  liveKitVoiceAgentRoomOutputOptions,
} from "./livekit-target-audio-config.js";
import {
  voiceAgentTargetTrackName,
} from "./livekit-target-audio-support.js";

initializeLogger({ pretty: false, level: "silent" });

describe("LiveKit Voice Agent target audio output", () => {
  it("publishes only the exact Air target track and forwards PCM after subscription", async () => {
    const captures: AudioFrame[] = [];
    const source = {
      captureFrame: vi.fn(async (frame: AudioFrame) => captures.push(frame)),
      clearQueue: vi.fn(),
      waitForPlayout: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const waitForSubscription = vi.fn(async () => {});
    const publishTrack = vi.fn(async () => ({ waitForSubscription, sid: "TR_1" }));
    const createdTracks: Array<{ name: string; source: unknown }> = [];
    const rtc = {
      AudioSource: class {
        constructor() { return source; }
      },
      LocalAudioTrack: {
        createAudioTrack(name: string, audioSource: unknown) {
          const track = { name, source: audioSource, close: vi.fn(async () => {}) };
          createdTracks.push(track);
          return track;
        },
      },
      TrackPublishOptions: class { source?: unknown; },
      TrackSource: { SOURCE_MICROPHONE: "microphone" },
    };
    const workerIdentity = "session-1:worker:voice_agent_abc_g1";
    const targetIdentity = "session-1:guest:air:air-001";
    const room = {
      localParticipant: { identity: workerIdentity, publishTrack },
    };
    const session = { output: { audio: null as voice.AudioOutput | null } };

    const routing = configureVoiceAgentSessionAudio(session, {
      room: room as never,
      rtc: rtc as never,
      telephonyProvider: "air780_volte",
      publisherIdentity: workerIdentity,
      targetParticipantIdentity: targetIdentity,
    });
    const output = routing.output!;
    await output.start(routing.abortController!.signal);
    const observation = output.observeNextSegment();
    const frame = new AudioFrame(new Int16Array(480), 24_000, 1, 480);
    await output.captureFrame(frame);
    output.flush();
    await output.waitForPlayout();

    expect(session.output.audio).toBe(output);
    expect(liveKitVoiceAgentRoomOutputOptions).toEqual({
      audioEnabled: false,
      transcriptionEnabled: true,
      syncTranscription: false,
    });
    expect(createdTracks).toHaveLength(1);
    expect(createdTracks[0]?.name).toBe(
      `translation-tts-guest-24000.${Buffer.from(targetIdentity).toString("base64url")}`,
    );
    expect(createdTracks[0]?.name).not.toBe("roomio_audio");
    expect(publishTrack.mock.calls[0]?.[1]).toMatchObject({ source: "microphone" });
    expect(waitForSubscription).toHaveBeenCalledOnce();
    expect(captures).toEqual([frame]);
    await expect(observation.started).resolves.toMatchObject({ audible: true });
    await expect(observation.finished).resolves.toMatchObject({
      interrupted: false,
    });
  });

  it("fails closed when the room publisher identity is not the bound worker", async () => {
    const session = { output: { audio: null as voice.AudioOutput | null } };
    const routing = configureVoiceAgentSessionAudio(session, {
      room: {
        localParticipant: {
          identity: "session-1:worker:attacker",
          publishTrack: vi.fn(),
        },
      } as never,
      telephonyProvider: "air780_volte",
      publisherIdentity: "session-1:worker:expected",
      targetParticipantIdentity: "session-1:guest:air:air-001",
    });

    await expect(routing.output!.start(routing.abortController!.signal))
      .rejects.toThrow("publisher identity mismatch");
  });

  it("leaves the existing RoomIO audio path enabled for SIP compatibility", () => {
    const session = { output: { audio: null as voice.AudioOutput | null } };
    const routing = configureVoiceAgentSessionAudio(session, {
      room: {} as never,
      telephonyProvider: "livekit_sip",
      publisherIdentity: "session-1:worker:voice-agent",
      targetParticipantIdentity: "sip-callee",
    });

    expect(routing.output).toBeUndefined();
    expect(session.output.audio).toBeNull();
    expect(routing.roomOutputOptions).toEqual({
      audioEnabled: true,
      transcriptionEnabled: true,
      syncTranscription: true,
    });
  });

  it("builds a deterministic exact-target track name", () => {
    expect(voiceAgentTargetTrackName("session-1:guest:air:air-001"))
      .toBe(`translation-tts-guest-24000.${
        Buffer.from("session-1:guest:air:air-001").toString("base64url")
      }`);
  });

  it("rejects and reports a pending chunk overflow without accepting it", async () => {
    const fixture = capacityFixture({
      maxPendingAudioMs: 6_000,
      maxPendingAudioChunks: 1,
    });
    await fixture.output.start(fixture.abortController.signal);
    const first = fixture.output.captureFrame(fixture.frame);
    await vi.waitFor(() => expect(fixture.captureFrame).toHaveBeenCalledOnce());

    await expect(fixture.output.captureFrame(fixture.frame)).rejects
      .toMatchObject({
        name: "VoiceAgentAudioCapacityError",
        evidence: {
          code: "voice_agent_pending_audio_capacity_exceeded",
          pendingAudioChunks: 2,
          maxPendingAudioChunks: 1,
        },
      });
    expect(fixture.onCapacityExceeded).toHaveBeenCalledWith(expect.objectContaining({
      code: "voice_agent_pending_audio_capacity_exceeded",
      pendingAudioChunks: 2,
    }));
    fixture.releaseCapture();
    await first;
    await fixture.output.close();
  });

  it("uses the duration limit for the RTC queue and concurrent pending audio", async () => {
    const fixture = capacityFixture({
      maxPendingAudioMs: 30,
      maxPendingAudioChunks: 10,
    });
    await fixture.output.start(fixture.abortController.signal);
    expect(fixture.sourceQueueSizeMs).toBe(30);
    const first = fixture.output.captureFrame(fixture.frame);
    await vi.waitFor(() => expect(fixture.captureFrame).toHaveBeenCalledOnce());

    await expect(fixture.output.captureFrame(fixture.frame)).rejects
      .toMatchObject({
        evidence: {
          pendingAudioMs: 40,
          maxPendingAudioMs: 30,
        },
      });
    fixture.releaseCapture();
    await first;
    await fixture.output.close();
  });

  it("does not report a first audio frame when an observation is cleared", async () => {
    const fixture = capacityFixture({
      maxPendingAudioMs: 6_000,
      maxPendingAudioChunks: 10,
    });
    await fixture.output.start(fixture.abortController.signal);
    const observation = fixture.output.observeNextSegment();

    fixture.output.clearBuffer();

    await expect(observation.started).resolves.toMatchObject({ audible: false });
    await expect(observation.finished).resolves.toMatchObject({
      interrupted: true,
      playbackPosition: 0,
    });
    await fixture.output.close();
  });
});

function capacityFixture(input: {
  maxPendingAudioMs: number;
  maxPendingAudioChunks: number;
}) {
  let releaseCapture = () => {};
  let sourceQueueSizeMs: number | undefined;
  const captureFrame = vi.fn(() => new Promise<void>((resolve) => {
    releaseCapture = resolve;
  }));
  const source = {
    captureFrame,
    clearQueue: vi.fn(),
    waitForPlayout: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const rtc = {
    AudioSource: class {
      constructor(_sampleRate: number, _channels: number, queueSizeMs?: number) {
        sourceQueueSizeMs = queueSizeMs;
        return source;
      }
    },
    LocalAudioTrack: {
      createAudioTrack() {
        return { close: vi.fn(async () => {}) };
      },
    },
    TrackPublishOptions: class { source?: unknown; },
    TrackSource: { SOURCE_MICROPHONE: "microphone" },
  };
  const room = {
    localParticipant: {
      identity: "session-1:worker:voice-agent",
      publishTrack: vi.fn(async () => ({
        waitForSubscription: vi.fn(async () => {}),
      })),
    },
  };
  const onCapacityExceeded = vi.fn();
  const output = new LiveKitTargetAudioOutput({
    room: room as never,
    rtc: rtc as never,
    publisherIdentity: "session-1:worker:voice-agent",
    targetParticipantIdentity: "session-1:guest:air:air-001",
    maxPendingAudioMs: input.maxPendingAudioMs,
    maxPendingAudioChunks: input.maxPendingAudioChunks,
    onCapacityExceeded,
  });
  return {
    output,
    abortController: new AbortController(),
    frame: new AudioFrame(new Int16Array(480), 24_000, 1, 480),
    captureFrame,
    onCapacityExceeded,
    get sourceQueueSizeMs() { return sourceQueueSizeMs; },
    releaseCapture: () => releaseCapture(),
  };
}
