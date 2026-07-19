import { expect } from "vitest";
import {
  LiveKitCallAudioSource,
  type LiveKitCallAudioSourceOptions,
  type RtcNodeModule,
} from "./livekit-call-audio-source.js";
import { CallRoomEndedError } from "./call-room-event-client.js";
import type { CallAudioFrame, CallAudioSpeakerRole } from "./types.js";

export class RecordingWorker {
  readonly started: string[] = [];
  readonly ended: string[] = [];
  readonly frames: CallAudioFrame[] = [];
  readonly ttsSinks: unknown[] = [];
  readonly lifecycle: string[] = [];
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
    this.lifecycle.push(`ended:${callId}`);
  }

  markCallEnded(callId: string) {
    this.lifecycle.push(`marked:${callId}`);
  }

  addTtsAudioSink(sink: unknown) {
    this.ttsSinks.push(sink);
  }

  setTtsVoice(voice: unknown) {
    this.ttsVoice = voice;
  }
}

export class CallEndedWorker extends RecordingWorker {
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

export function sourceForTest(
  rtc: ReturnType<typeof createFakeRtcNode>,
  worker: RecordingWorker,
  overrides: Pick<
    LiveKitCallAudioSourceOptions,
    "audioIngestMaxFrames" | "onCallEnded" | "onDiagnostics" |
      "onIngestMetrics" | "rtcStatsIntervalMs"
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
          participantIdentity: "translation-call_1",
          token: "worker-token",
          expiresAt: "2026-07-17T00:00:00.000Z",
        };
      },
    },
    loadRtcNode: async () => rtc.module,
    ...overrides,
  });
}

export function createFakeRtcNode(options: {
  localPublishing?: boolean;
  frameCount?: number;
} = {}) {
  class RemoteAudioTrack {}
  class FakeAudioStream extends ReadableStream<{
    data: Int16Array;
    sampleRate: number;
  }> {
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
    module: module as unknown as RtcNodeModule,
  };
}

class FakeRoom {
  connected: unknown = null;
  localParticipant?: {
    publishTrack(track: unknown, options: unknown): Promise<{ sid: string }>;
  };
  private readonly listeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();

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

export async function eventually(predicate: () => boolean) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate()).toBe(true);
}
