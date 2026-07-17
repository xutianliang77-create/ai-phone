import { describe, expect, it } from "vitest";
import {
  LiveKitCallAudioSource,
} from "./livekit-call-audio-source.js";
import {
  createFakeRtcNode,
  eventually,
  RecordingWorker,
} from "./livekit-call-audio-source.test-support.js";

describe("LiveKitCallAudioSource", () => {
  it("joins the room with a worker token and forwards remote audio frames", async () => {
    const rtc = createFakeRtcNode();
    const worker = new RecordingWorker(() => {
      expect(rtc.room.connected).not.toBeNull();
    });
    const source = new LiveKitCallAudioSource({
      callId: "call_1",
      worker: worker as never,
      audioSampleRate: 24000,
      audioFrameSizeMs: 100,
      nowMs: () => 123,
      tokenClient: {
        async createWorkerToken() {
          return {
            callId: "call_1",
            sessionId: "call_1",
            provider: "livekit",
            roomName: "call_call_1",
            wsUrl: "wss://livekit.example.cn",
            participantRole: "worker",
            token: "worker-token",
            expiresAt: "2026-07-03T00:00:00.000Z",
          };
        },
      },
      loadRtcNode: async () => rtc.module,
    });

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      { metadata: JSON.stringify({ participantRole: "guest" }) },
    );
    await eventually(() => worker.frames.length === 1);
    await source.stop();

    expect(rtc.room.connected).toEqual({
      url: "wss://livekit.example.cn",
      token: "worker-token",
      opts: { autoSubscribe: true, dynacast: false },
    });
    expect(worker.started).toEqual(["call_1"]);
    expect(worker.frames[0]).toMatchObject({
      sessionId: "call_1",
      speakerRole: "guest",
      sequence: 1,
      timestampMs: 123,
      format: "pcm16",
      sampleRate: 24000,
    });
    expect(worker.frames[0].data).toBe(Buffer.from(new Int16Array([1, -1]).buffer).toString("base64"));
    expect(worker.ended).toEqual(["call_1"]);
  });

  it("ignores non host or guest participants", async () => {
    const worker = new RecordingWorker();
    const rtc = createFakeRtcNode();
    const source = new LiveKitCallAudioSource({
      callId: "call_1",
      worker: worker as never,
      audioSampleRate: 24000,
      audioFrameSizeMs: 100,
      tokenClient: {
        async createWorkerToken() {
          return {
            callId: "call_1",
            sessionId: "call_1",
            provider: "livekit",
            roomName: "call_call_1",
            wsUrl: "wss://livekit.example.cn",
            participantRole: "worker",
            token: "worker-token",
            expiresAt: "2026-07-03T00:00:00.000Z",
          };
        },
      },
      loadRtcNode: async () => rtc.module,
    });

    await source.start();
    rtc.room.emit("trackSubscribed", new rtc.RemoteAudioTrack(), {}, { metadata: "" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();

    expect(worker.frames).toEqual([]);
  });

  it("ignores translation TTS tracks so playback is not reprocessed as input", async () => {
    const worker = new RecordingWorker();
    const rtc = createFakeRtcNode();
    const source = new LiveKitCallAudioSource({
      callId: "call_1",
      worker: worker as never,
      audioSampleRate: 24000,
      audioFrameSizeMs: 100,
      tokenClient: {
        async createWorkerToken() {
          return {
            callId: "call_1",
            sessionId: "call_1",
            provider: "livekit",
            roomName: "call_call_1",
            wsUrl: "wss://livekit.example.cn",
            participantRole: "worker",
            token: "worker-token",
            expiresAt: "2026-07-03T00:00:00.000Z",
          };
        },
      },
      loadRtcNode: async () => rtc.module,
    });

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      { name: "translation-tts-guest-24000" },
      { metadata: JSON.stringify({ participantRole: "guest" }) },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await source.stop();

    expect(worker.frames).toEqual([]);
  });

  it("attaches a LiveKit TTS audio sink after local track publishing becomes available", async () => {
    const worker = new RecordingWorker();
    const rtc = createFakeRtcNode({ localPublishing: true });
    const source = new LiveKitCallAudioSource({
      callId: "call_1",
      worker: worker as never,
      audioSampleRate: 24000,
      audioFrameSizeMs: 100,
      tokenClient: {
        async createWorkerToken() {
          return {
            callId: "call_1",
            sessionId: "call_1",
            provider: "livekit",
            roomName: "call_call_1",
            wsUrl: "wss://livekit.example.cn",
            participantRole: "worker",
            token: "worker-token",
            expiresAt: "2026-07-03T00:00:00.000Z",
          };
        },
      },
      loadRtcNode: async () => rtc.module,
    });

    await source.start();
    await source.stop();

    expect(worker.ttsSinks).toHaveLength(1);
  });

  it("applies TTS voice settings returned with the worker token", async () => {
    const worker = new RecordingWorker();
    const rtc = createFakeRtcNode();
    const source = new LiveKitCallAudioSource({
      callId: "call_1",
      worker: worker as never,
      audioSampleRate: 24000,
      audioFrameSizeMs: 100,
      tokenClient: {
        async createWorkerToken() {
          return {
            callId: "call_1",
            sessionId: "call_1",
            provider: "livekit",
            roomName: "call_call_1",
            wsUrl: "wss://livekit.example.cn",
            participantRole: "worker",
            token: "worker-token",
            expiresAt: "2026-07-03T00:00:00.000Z",
            ttsVoice: {
              mode: "personal_clone",
              voiceProfileId: "voice-profile-1",
              referenceAudioId: "voice-profile-1",
            },
          };
        },
      },
      loadRtcNode: async () => rtc.module,
    });

    await source.start();
    await source.stop();

    expect(worker.ttsVoice).toEqual({
      mode: "personal_clone",
      voiceProfileId: "voice-profile-1",
      referenceAudioId: "voice-profile-1",
    });
  });

});
