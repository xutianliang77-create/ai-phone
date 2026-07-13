import { describe, expect, it } from "vitest";
import { LiveKitCallAudioSource } from "./livekit-call-audio-source.js";
import type { CallAudioFrame, CallAudioSpeakerRole } from "./types.js";

describe("LiveKitCallAudioSource", () => {
  it("joins the room with a worker token and forwards remote audio frames", async () => {
    const worker = new RecordingWorker();
    const rtc = createFakeRtcNode();
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

class RecordingWorker {
  readonly started: string[] = [];
  readonly ended: string[] = [];
  readonly frames: CallAudioFrame[] = [];
  readonly ttsSinks: unknown[] = [];
  ttsVoice: unknown = null;

  async startCall(callId: string) {
    this.started.push(callId);
  }

  async processAudioFrame(frame: CallAudioFrame) {
    this.frames.push(frame);
  }

  async flushSpeaker(_callId: string, _speakerRole: CallAudioSpeakerRole) {}

  async endCall(callId: string) {
    this.ended.push(callId);
  }

  addTtsAudioSink(sink: unknown) {
    this.ttsSinks.push(sink);
  }

  setTtsVoice(voice: unknown) {
    this.ttsVoice = voice;
  }
}

function createFakeRtcNode(options: { localPublishing?: boolean } = {}) {
  class RemoteAudioTrack {}
  class FakeAudioStream extends ReadableStream<{ data: Int16Array; sampleRate: number }> {
    constructor() {
      super({
        start(controller) {
          controller.enqueue({ data: new Int16Array([1, -1]), sampleRate: 24000 });
          controller.close();
        },
      });
    }
  }
  const room = new FakeRoom(options.localPublishing);
  const module: Record<string, unknown> = {
    Room: class {
      constructor() {
        return room;
      }
    },
    RoomEvent: {
      TrackSubscribed: "trackSubscribed",
      Disconnected: "disconnected",
    },
    AudioStream: FakeAudioStream,
    RemoteAudioTrack,
    async dispose() {},
  };
  if (options.localPublishing) {
    module.AudioFrame = class {
      constructor(
        readonly data: Int16Array,
        readonly sampleRate: number,
        readonly channels: number,
        readonly samplesPerChannel: number,
      ) {}
    };
    module.AudioSource = class {
      async captureFrame(_frame: unknown) {}
    };
    module.LocalAudioTrack = {
      createAudioTrack: (name: string, source: unknown) => ({ name, source }),
    };
    module.TrackPublishOptions = class {
      source?: unknown;
    };
    module.TrackSource = { SOURCE_MICROPHONE: "microphone" };
  }
  return {
    room,
    RemoteAudioTrack,
    module,
  };
}

class FakeRoom {
  connected: unknown = null;
  localParticipant?: { publishTrack(track: unknown, options: unknown): Promise<unknown> };
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(private readonly localPublishing = false) {}

  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  async connect(url: string, token: string, opts: unknown) {
    this.connected = { url, token, opts };
    if (this.localPublishing) {
      this.localParticipant = { publishTrack: async () => ({}) };
    }
  }

  async disconnect() {
    this.emit("disconnected");
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
}
