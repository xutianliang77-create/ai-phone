import { describe, expect, it } from "vitest";
import {
  LiveKitCallAudioSource,
  type LiveKitCallAudioSourceOptions,
} from "./livekit-call-audio-source.js";
import { CallRoomEndedError } from "./call-room-event-client.js";
import type { AudioIngestMetrics } from "./audio-ingest-ring-buffer.js";
import type { CallAudioFrame, CallAudioSpeakerRole } from "./types.js";

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

  it("keeps reading RTC audio while slow ASR drops the oldest bounded backlog", async () => {
    const rtc = createFakeRtcNode({ frameCount: 5 });
    let releaseFirstFrame: (() => void) | undefined;
    const firstFrameGate = new Promise<void>((resolve) => {
      releaseFirstFrame = resolve;
    });
    const worker = new RecordingWorker(undefined, async (frame) => {
      if (frame.sequence === 1) await firstFrameGate;
    });
    const metrics: AudioIngestMetrics[] = [];
    const source = sourceForTest(rtc, worker, {
      audioIngestMaxFrames: 2,
      onIngestMetrics: (snapshot) => metrics.push(snapshot),
    });

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      { metadata: JSON.stringify({ participantRole: "guest" }) },
    );
    await eventually(() =>
      metrics.some((item) =>
        item.event === "backpressure" && item.receivedFrames === 5
      )
    );

    expect(worker.frames.map((frame) => frame.sequence)).toEqual([1]);
    const pressure = metrics.filter((item) => item.event === "backpressure").at(-1)!;
    expect(pressure).toMatchObject({
      legId: "guest:1",
      capacityFrames: 2,
      highWatermarkFrames: 2,
      receivedFrames: 5,
      droppedFrames: 2,
      overflowDroppedFrames: 2,
      backpressureEvents: 2,
    });

    releaseFirstFrame?.();
    await eventually(() => worker.frames.length === 3);
    await source.stop();

    expect(worker.frames.map((frame) => frame.sequence)).toEqual([1, 4, 5]);
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "sequence_gap",
      sequenceGapFrames: 2,
      lastProcessedSequence: 4,
    }));
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "drained",
      receivedFrames: 5,
      processedFrames: 3,
      droppedFrames: 2,
      queueDepthFrames: 0,
    }));
  });

  it("treats call-ended publication as a clean terminal signal", async () => {
    const rtc = createFakeRtcNode();
    const ended: CallRoomEndedError[] = [];
    const metrics: AudioIngestMetrics[] = [];
    const worker = new CallEndedWorker();
    const source = sourceForTest(rtc, worker, {
      onCallEnded: (error) => ended.push(error),
      onIngestMetrics: (snapshot) => metrics.push(snapshot),
    });

    await source.start();
    rtc.room.emit(
      "trackSubscribed",
      new rtc.RemoteAudioTrack(),
      {},
      { metadata: JSON.stringify({ participantRole: "guest" }) },
    );
    await source.waitUntilDisconnected();
    await expect(Promise.all([source.stop(), source.stop()])).resolves.toBeDefined();

    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      code: "call_room_ended",
      callId: "call_1",
    });
    expect(worker.endAttempts).toBe(1);
    expect(metrics).toContainEqual(expect.objectContaining({
      event: "stopped",
      receivedFrames: 1,
      dequeuedFrames: 1,
      processedFrames: 0,
      failedFrames: 1,
      inFlightFrames: 0,
      droppedFrames: 0,
    }));
  });
});

class RecordingWorker {
  readonly started: string[] = [];
  readonly ended: string[] = [];
  readonly frames: CallAudioFrame[] = [];
  readonly ttsSinks: unknown[] = [];
  ttsVoice: unknown = null;

  constructor(
    private readonly onStart?: () => void,
    private readonly onFrame?: (frame: CallAudioFrame) => Promise<void> | void,
  ) {}

  async startCall(callId: string) {
    this.onStart?.();
    this.started.push(callId);
  }

  async processAudioFrame(frame: CallAudioFrame) {
    this.frames.push(frame);
    await this.onFrame?.(frame);
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

class CallEndedWorker extends RecordingWorker {
  endAttempts = 0;

  override async processAudioFrame(frame: CallAudioFrame) {
    await super.processAudioFrame(frame);
    throw new CallRoomEndedError(frame.sessionId);
  }

  override async endCall(callId: string) {
    this.endAttempts += 1;
    throw new CallRoomEndedError(callId);
  }
}

function sourceForTest(
  rtc: ReturnType<typeof createFakeRtcNode>,
  worker: RecordingWorker,
  overrides: Pick<
    LiveKitCallAudioSourceOptions,
    "audioIngestMaxFrames" | "onCallEnded" | "onIngestMetrics"
  > = {},
) {
  return new LiveKitCallAudioSource({
    callId: "call_1",
    worker: worker as never,
    audioSampleRate: 24000,
    audioFrameSizeMs: 100,
    tokenClient: {
      async createWorkerToken() {
        return {
          callId: "call_1",
          sessionId: "call_1",
          provider: "livekit" as const,
          roomName: "call_call_1",
          wsUrl: "wss://livekit.example.cn",
          participantRole: "worker" as const,
          token: "worker-token",
          expiresAt: "2026-07-17T00:00:00.000Z",
        };
      },
    },
    loadRtcNode: async () => rtc.module,
    ...overrides,
  });
}

function createFakeRtcNode(options: {
  localPublishing?: boolean;
  frameCount?: number;
} = {}) {
  class RemoteAudioTrack {}
  class FakeAudioStream extends ReadableStream<{ data: Int16Array; sampleRate: number }> {
    constructor() {
      super({
        start(controller) {
          for (let index = 0; index < (options.frameCount ?? 1); index += 1) {
            controller.enqueue({
              data: new Int16Array([index + 1, -(index + 1)]),
              sampleRate: 24000,
            });
          }
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
  localParticipant?: {
    publishTrack(track: unknown, options: unknown): Promise<{ sid: string }>;
  };
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  constructor(private readonly localPublishing = false) {}

  on(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  async connect(url: string, token: string, opts: unknown) {
    this.connected = { url, token, opts };
    if (this.localPublishing) {
      this.localParticipant = { publishTrack: async () => ({ sid: "TR_1" }) };
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
