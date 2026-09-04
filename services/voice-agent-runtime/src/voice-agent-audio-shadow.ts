import {
  AudioStream,
  type AudioFrame,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type Room,
  RoomEvent,
  TrackKind,
} from "@livekit/rtc-node";
import type { QwenAudioRealtimeShadowConfig } from "./config.js";
import {
  QwenAudioRealtimeShadowClient,
  type QwenAudioShadowTelemetry,
} from "./qwen-audio-realtime-shadow-client.js";

const FRAME_SAMPLES = 320;
const FRAMES_PER_BATCH = 5;

export class VoiceAgentAudioShadow {
  private readonly abort = new AbortController();
  private readonly client: QwenAudioRealtimeShadowClient;
  private reader?: ReadableStreamDefaultReader<AudioFrame>;
  private consumeTask?: Promise<void>;
  private stopped = false;

  constructor(private readonly input: {
    config: QwenAudioRealtimeShadowConfig;
    room: Room;
    participant: RemoteParticipant;
    client?: QwenAudioRealtimeShadowClient;
    onError?: (error: unknown) => void;
    onStopped?: (telemetry: QwenAudioShadowTelemetry) => void;
  }) {
    this.client = input.client ??
      new QwenAudioRealtimeShadowClient(input.config);
  }

  async start() {
    if (this.stopped) return;
    try {
      const track = await waitForSingleCalleeAudioTrack(
        this.input.room,
        this.input.participant,
        this.abort.signal,
        this.input.config.connectTimeoutMs,
      );
      if (this.stopped) return;
      await this.client.connect();
      if (this.stopped) return;
      const stream = new AudioStream(track, {
        sampleRate: 16_000,
        numChannels: 1,
        frameSizeMs: 20,
      });
      this.reader = stream.getReader();
      this.consumeTask = this.consume(this.reader);
      await this.consumeTask;
    } catch (error) {
      if (!this.stopped && !this.abort.signal.aborted) {
        this.input.onError?.(error);
      }
    } finally {
      this.client.close();
    }
  }

  async close() {
    if (this.stopped) return;
    this.stopped = true;
    this.abort.abort();
    await this.reader?.cancel().catch(() => undefined);
    this.client.close();
    await this.consumeTask?.catch(() => undefined);
    this.input.onStopped?.(this.client.telemetry());
  }

  telemetry() {
    return this.client.telemetry();
  }

  private async consume(
    reader: ReadableStreamDefaultReader<AudioFrame>,
  ) {
    const frames: Int16Array[] = [];
    while (!this.stopped) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value.sampleRate !== 16_000 || value.channels !== 1 ||
          value.samplesPerChannel !== FRAME_SAMPLES ||
          value.data.length !== FRAME_SAMPLES) {
        continue;
      }
      frames.push(Int16Array.from(value.data));
      if (frames.length !== FRAMES_PER_BATCH) continue;
      this.client.appendPcm100ms(encodePcm16Le(frames));
      frames.length = 0;
    }
  }
}

async function waitForSingleCalleeAudioTrack(
  room: Room,
  participant: RemoteParticipant,
  signal: AbortSignal,
  timeoutMs: number,
) {
  if (signal.aborted) throw new Error("shadow_audio_track_aborted");
  const existing = subscribedAudioTracks(participant);
  if (existing.length === 1) return existing[0]!;
  if (existing.length > 1) throw new Error("shadow_audio_track_ambiguous");
  return new Promise<RemoteTrack>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      signal.removeEventListener("abort", onAbort);
    };
    const finish = (track: RemoteTrack) => {
      cleanup();
      resolve(track);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      joined: RemoteParticipant,
    ) => {
      if (joined.identity !== participant.identity ||
          publication.kind !== TrackKind.KIND_AUDIO) return;
      const tracks = subscribedAudioTracks(participant);
      if (tracks.length > 1) {
        fail(new Error("shadow_audio_track_ambiguous"));
      } else if (tracks.length === 1) {
        finish(track);
      }
    };
    const onAbort = () => fail(new Error("shadow_audio_track_aborted"));
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    signal.addEventListener("abort", onAbort, { once: true });
    const afterSubscription = subscribedAudioTracks(participant);
    if (afterSubscription.length > 1) {
      fail(new Error("shadow_audio_track_ambiguous"));
      return;
    }
    if (afterSubscription.length === 1) {
      finish(afterSubscription[0]!);
      return;
    }
    timer = setTimeout(
      () => fail(new Error("shadow_audio_track_timeout")),
      timeoutMs,
    );
    timer.unref();
  });
}

function subscribedAudioTracks(participant: RemoteParticipant) {
  return [...participant.trackPublications.values()]
    .filter((publication) => publication.kind === TrackKind.KIND_AUDIO &&
      publication.subscribed && publication.track)
    .map((publication) => publication.track!);
}

function encodePcm16Le(frames: Int16Array[]) {
  const output = Buffer.allocUnsafe(
    FRAME_SAMPLES * FRAMES_PER_BATCH * Int16Array.BYTES_PER_ELEMENT,
  );
  let offset = 0;
  for (const frame of frames) {
    for (const sample of frame) {
      output.writeInt16LE(sample, offset);
      offset += Int16Array.BYTES_PER_ELEMENT;
    }
  }
  return output;
}
