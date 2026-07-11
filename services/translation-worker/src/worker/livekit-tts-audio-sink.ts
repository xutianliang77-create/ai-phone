import type { CallTtsAudioSink, SynthesizedSpeech } from "./types.js";

export interface LiveKitTtsRtcModule {
  AudioFrame: new (
    data: Int16Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ) => unknown;
  AudioSource: new (sampleRate: number, numChannels: number) => LiveKitAudioSource;
  LocalAudioTrack: {
    createAudioTrack(name: string, source: LiveKitAudioSource): unknown;
  };
  TrackPublishOptions: new () => { source?: unknown };
  TrackSource: { SOURCE_MICROPHONE?: unknown };
}

export interface LiveKitTtsRoom {
  localParticipant?: {
    publishTrack(track: unknown, options: unknown): Promise<unknown>;
  };
}

interface LiveKitAudioSource {
  captureFrame(frame: unknown): Promise<void>;
  waitForPlayout?: () => Promise<void>;
}

interface PublishedAudioTrack {
  source: LiveKitAudioSource;
  sampleRate: 16000 | 24000;
}

export class LiveKitTtsAudioSink implements CallTtsAudioSink {
  private readonly tracks = new Map<string, Promise<PublishedAudioTrack>>();
  private readonly playQueues = new Map<string, Promise<void>>();

  constructor(private readonly options: {
    room: LiveKitTtsRoom;
    rtc: LiveKitTtsRtcModule;
    frameSizeMs?: number;
  }) {}

  async play(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    if (!input.speech.audio) throw new Error("LiveKit TTS sink requires PCM audio");
    const key = trackKey(input.targetSpeakerRole, input.speech.audio.sampleRate);
    const previous = this.playQueues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.playOnTrack(input));
    this.playQueues.set(key, next);
    try {
      await next;
    } finally {
      if (this.playQueues.get(key) === next) this.playQueues.delete(key);
    }
  }

  private async playOnTrack(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    const audio = input.speech.audio;
    if (!audio) throw new Error("LiveKit TTS sink requires PCM audio");
    const track = await this.trackFor(input.targetSpeakerRole, audio.sampleRate);
    for (const chunk of chunkSamples(audio, this.options.frameSizeMs ?? 100)) {
      await track.source.captureFrame(new this.options.rtc.AudioFrame(
        chunk,
        track.sampleRate,
        1,
        chunk.length,
      ));
    }
    await track.source.waitForPlayout?.();
  }

  private async trackFor(
    targetSpeakerRole: "host" | "guest",
    sampleRate: 16000 | 24000,
  ) {
    const key = trackKey(targetSpeakerRole, sampleRate);
    const existing = this.tracks.get(key);
    if (existing) return existing;
    const created = this.publishTrack(targetSpeakerRole, sampleRate);
    this.tracks.set(key, created);
    return created;
  }

  private async publishTrack(
    targetSpeakerRole: "host" | "guest",
    sampleRate: 16000 | 24000,
  ): Promise<PublishedAudioTrack> {
    const participant = this.options.room.localParticipant;
    if (!participant) throw new Error("LiveKit room has no local participant");
    const source = new this.options.rtc.AudioSource(sampleRate, 1);
    const track = this.options.rtc.LocalAudioTrack.createAudioTrack(
      `translation-tts-${targetSpeakerRole}-${sampleRate}`,
      source,
    );
    const publishOptions = new this.options.rtc.TrackPublishOptions();
    publishOptions.source = this.options.rtc.TrackSource.SOURCE_MICROPHONE;
    await participant.publishTrack(track, publishOptions);
    return { source, sampleRate };
  }
}

function trackKey(targetSpeakerRole: "host" | "guest", sampleRate: 16000 | 24000) {
  return `${targetSpeakerRole}:${sampleRate}`;
}

export function isLiveKitTtsAudioSupported(
  room: LiveKitTtsRoom,
  rtc: Partial<LiveKitTtsRtcModule>,
) {
  return Boolean(
    room.localParticipant?.publishTrack &&
      rtc.AudioFrame &&
      rtc.AudioSource &&
      rtc.LocalAudioTrack?.createAudioTrack &&
      rtc.TrackPublishOptions &&
      rtc.TrackSource,
  );
}

function chunkSamples(
  audio: NonNullable<SynthesizedSpeech["audio"]>,
  frameSizeMs: number,
) {
  const samples = pcm16Base64ToSamples(audio.data);
  const frameSize = Math.max(1, Math.floor(audio.sampleRate * frameSizeMs / 1000));
  const chunks: Int16Array[] = [];
  for (let offset = 0; offset < samples.length; offset += frameSize) {
    chunks.push(samples.slice(offset, offset + frameSize));
  }
  return chunks;
}

function pcm16Base64ToSamples(data: string) {
  const buffer = Buffer.from(data, "base64");
  const sampleCount = Math.floor(buffer.byteLength / 2);
  const samples = new Int16Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = buffer.readInt16LE(index * 2);
  }
  return samples;
}
