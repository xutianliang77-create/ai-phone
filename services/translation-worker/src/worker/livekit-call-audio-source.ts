import type { CallAudioSpeakerRole, CallSpeechPipeline } from "./types.js";
import type {
  CallRoomWorkerToken,
  HttpCallRoomTokenClient,
} from "./call-room-token-client.js";
import {
  isLiveKitTtsAudioSupported,
  LiveKitTtsAudioSink,
  type LiveKitTtsRtcModule,
  type LiveKitTtsRoom,
} from "./livekit-tts-audio-sink.js";

export interface LiveKitCallAudioSourceOptions {
  callId: string;
  tokenClient: Pick<HttpCallRoomTokenClient, "createWorkerToken">;
  worker: CallSpeechPipeline;
  audioSampleRate: 16000 | 24000;
  audioFrameSizeMs: number;
  loadRtcNode?: () => Promise<RtcNodeModule>;
  nowMs?: () => number;
}

interface RtcNodeModule extends Partial<LiveKitTtsRtcModule> {
  Room: new () => RtcRoom;
  RoomEvent: { TrackSubscribed: string; Disconnected: string };
  AudioStream: new (
    track: unknown,
    options: { sampleRate: number; numChannels: number; frameSizeMs: number },
  ) => ReadableStream<RtcAudioFrame>;
  RemoteAudioTrack?: new (...args: unknown[]) => object;
  dispose?: () => Promise<void>;
}

interface RtcRoom extends LiveKitTtsRoom {
  on(event: string, listener: (...args: unknown[]) => void): RtcRoom;
  connect(url: string, token: string, opts: {
    autoSubscribe: boolean;
    dynacast: boolean;
  }): Promise<void>;
  disconnect(): Promise<void>;
}

interface RtcAudioFrame {
  data: Int16Array;
  sampleRate: number;
}

export class LiveKitCallAudioSource {
  private room: RtcRoom | null = null;
  private rtc: RtcNodeModule | null = null;
  private sequence = 0;
  private stopped = false;
  private readonly disconnected = deferred<void>();

  constructor(private readonly options: LiveKitCallAudioSourceOptions) {}

  async start() {
    const token = await this.options.tokenClient.createWorkerToken(this.options.callId);
    const rtc = await this.loadRtcNode();
    const room = new rtc.Room();
    this.rtc = rtc;
    this.room = room;

    if (token.ttsVoice) this.options.worker.setTtsVoice(token.ttsVoice);
    await this.options.worker.startCall(this.options.callId);
    room
      .on(rtc.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        void this.handleTrackSubscribed(track, publication, participant, rtc);
      })
      .on(rtc.RoomEvent.Disconnected, () => {
        this.disconnected.resolve();
      });
    await room.connect(token.wsUrl, token.token, {
      autoSubscribe: true,
      dynacast: false,
    });
    this.attachLiveKitTtsSink(room, rtc);
    return token;
  }

  async waitUntilDisconnected() {
    await this.disconnected.promise;
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    await this.room?.disconnect();
    await this.options.worker.endCall(this.options.callId);
    await this.rtc?.dispose?.();
    this.disconnected.resolve();
  }

  private async handleTrackSubscribed(
    track: unknown,
    publication: unknown,
    participant: unknown,
    rtc: RtcNodeModule,
  ) {
    if (!shouldForwardAudioTrack(track, publication)) return;
    const speakerRole = participantRole(participant);
    if (!speakerRole || !isRemoteAudioTrack(track, rtc)) return;

    const stream = new rtc.AudioStream(track, {
      sampleRate: this.options.audioSampleRate,
      numChannels: 1,
      frameSizeMs: this.options.audioFrameSizeMs,
    });
    await this.pumpAudioStream(stream, speakerRole);
  }

  private async pumpAudioStream(
    stream: ReadableStream<RtcAudioFrame>,
    speakerRole: CallAudioSpeakerRole,
  ) {
    const reader = stream.getReader();
    try {
      while (!this.stopped) {
        const result = await reader.read();
        if (result.done) break;
        await this.options.worker.processAudioFrame({
          type: "audio.frame",
          sessionId: this.options.callId,
          speakerRole,
          sequence: ++this.sequence,
          timestampMs: this.options.nowMs?.() ?? Date.now(),
          format: "pcm16",
          sampleRate: normalizeSampleRate(result.value.sampleRate),
          data: int16Base64(result.value.data),
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async loadRtcNode() {
    try {
      return await (this.options.loadRtcNode ?? loadRtcNode)();
    } catch (error) {
      throw new Error(
        "LiveKit Node RTC runtime is unavailable. Install @livekit/rtc-node before running the Translation Worker.",
        { cause: error },
      );
    }
  }

  private attachLiveKitTtsSink(room: RtcRoom, rtc: RtcNodeModule) {
    if (!isLiveKitTtsAudioSupported(room, rtc)) return;
    this.options.worker.addTtsAudioSink(new LiveKitTtsAudioSink({
      room,
      rtc: rtc as LiveKitTtsRtcModule,
    }));
  }
}

function shouldForwardAudioTrack(track: unknown, publication: unknown) {
  return !isTranslationTtsTrackName(audioTrackName(track, publication));
}

function audioTrackName(track: unknown, publication: unknown) {
  const value = publication as { name?: unknown; trackName?: unknown };
  if (typeof value.name === "string" && value.name) return value.name;
  if (typeof value.trackName === "string" && value.trackName) return value.trackName;
  const trackValue = track as { name?: unknown };
  return typeof trackValue.name === "string" ? trackValue.name : "";
}

function isTranslationTtsTrackName(trackName: string) {
  return /^translation-tts-(host|guest)-[1-9][0-9]*(?:\.[A-Za-z0-9_-]+)?$/.test(trackName);
}

function participantRole(participant: unknown): CallAudioSpeakerRole | null {
  const value = participant as { metadata?: unknown; identity?: unknown };
  const fromMetadata = parseMetadataRole(value.metadata);
  if (fromMetadata) return fromMetadata;
  const identity = typeof value.identity === "string" ? value.identity : "";
  if (identity.includes(":host:")) return "host";
  if (identity.includes(":guest:")) return "guest";
  return null;
}

function parseMetadataRole(metadata: unknown): CallAudioSpeakerRole | null {
  if (typeof metadata !== "string" || !metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { participantRole?: unknown };
    if (parsed.participantRole === "host" || parsed.participantRole === "guest") {
      return parsed.participantRole;
    }
  } catch {
    return null;
  }
  return null;
}

function isRemoteAudioTrack(track: unknown, rtc: RtcNodeModule) {
  if (!rtc.RemoteAudioTrack) return true;
  return track instanceof rtc.RemoteAudioTrack;
}

function normalizeSampleRate(sampleRate: number): 16000 | 24000 {
  return sampleRate === 16000 ? 16000 : 24000;
}

function int16Base64(data: Int16Array) {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function loadRtcNode(): Promise<RtcNodeModule> {
  const dynamicImport = new Function("name", "return import(name)") as
    (name: string) => Promise<RtcNodeModule>;
  return dynamicImport("@livekit/rtc-node");
}
