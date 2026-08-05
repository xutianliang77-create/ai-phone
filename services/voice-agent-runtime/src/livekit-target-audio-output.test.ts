import { initializeLogger, voice } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { describe, expect, it, vi } from "vitest";
import {
  configureVoiceAgentSessionAudio,
  liveKitVoiceAgentRoomOutputOptions,
  voiceAgentTargetTrackName,
} from "./livekit-target-audio-output.js";

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
});
