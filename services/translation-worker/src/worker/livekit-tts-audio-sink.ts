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
    publishTrack(
      track: unknown,
      options: unknown,
    ): Promise<{ sid?: unknown }>;
  };
}

export interface LiveKitTtsTrackAccess {
  authorizeTrack(input: {
    targetLegId: string;
    targetSpeakerRole: "host" | "guest";
    trackSid: string;
    trackName: string;
  }): Promise<void>;
}

interface LiveKitAudioSource {
  captureFrame(frame: unknown): Promise<void>;
  clearQueue?: () => void;
  waitForPlayout?: () => Promise<void>;
}

interface PublishedAudioTrack {
  source: LiveKitAudioSource;
  sampleRate: 16000 | 24000;
}

export class LiveKitTtsAudioSink implements CallTtsAudioSink {
  readonly capabilities = {
    bidirectionalMedia: true,
    streamingWrite: true,
    clearPlayback: true,
  } as const;
  private readonly tracks = new Map<string, Promise<PublishedAudioTrack>>();
  private readonly playQueues = new Map<string, Promise<void>>();
  private readonly generations = new Map<string, number>();

  constructor(private readonly options: {
    room: LiveKitTtsRoom;
    rtc: LiveKitTtsRtcModule;
    frameSizeMs?: number;
    trackAccess?: LiveKitTtsTrackAccess;
  }) {}

  async play(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    if (!input.speech.audio) throw new Error("LiveKit TTS sink requires PCM audio");
    const key = trackKey(input.targetLegId, input.speech.audio.sampleRate);
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
    return { status: "played" as const };
  }

  async interrupt(input: Parameters<NonNullable<CallTtsAudioSink["interrupt"]>>[0]) {
    if (this.generations.get(input.targetLegId) !== input.generation) {
      return { cleared: false };
    }
    const matching = [...this.tracks.entries()].filter(([key]) =>
      key.startsWith(`${input.targetLegId}:`)
    );
    if (matching.length === 0) return { cleared: false };
    const tracks = await Promise.all(matching.map(([, track]) => track));
    if (tracks.some((track) => !track.source.clearQueue)) {
      return { cleared: false };
    }
    this.generations.set(input.targetLegId, input.generation + 1);
    for (const track of tracks) track.source.clearQueue?.();
    return { cleared: true };
  }

  private async playOnTrack(input: Parameters<CallTtsAudioSink["play"]>[0]) {
    const audio = input.speech.audio;
    if (!audio) throw new Error("LiveKit TTS sink requires PCM audio");
    const latest = this.generations.get(input.targetLegId) ?? 0;
    if (input.generation < latest) throw new Error("Stale LiveKit playback generation");
    this.generations.set(input.targetLegId, input.generation);
    const track = await this.trackFor(
      input.targetSpeakerRole,
      input.targetLegId,
      audio.sampleRate,
    );
    for (const chunk of chunkSamples(audio, this.options.frameSizeMs ?? 100)) {
      assertCurrentPlayback(this.generations, input);
      await track.source.captureFrame(new this.options.rtc.AudioFrame(
        chunk,
        track.sampleRate,
        1,
        chunk.length,
      ));
      if (input.signal.aborted ||
        this.generations.get(input.targetLegId) !== input.generation) {
        track.source.clearQueue?.();
        throw new Error("LiveKit playback interrupted");
      }
    }
    await track.source.waitForPlayout?.();
  }

  private async trackFor(
    targetSpeakerRole: "host" | "guest",
    targetLegId: string,
    sampleRate: 16000 | 24000,
  ) {
    const key = trackKey(targetLegId, sampleRate);
    const existing = this.tracks.get(key);
    if (existing) return existing;
    const created = this.publishTrack(targetSpeakerRole, targetLegId, sampleRate);
    this.tracks.set(key, created);
    return created;
  }

  private async publishTrack(
    targetSpeakerRole: "host" | "guest",
    targetLegId: string,
    sampleRate: 16000 | 24000,
  ): Promise<PublishedAudioTrack> {
    const participant = this.options.room.localParticipant;
    if (!participant) throw new Error("LiveKit room has no local participant");
    const source = new this.options.rtc.AudioSource(sampleRate, 1);
    const trackName = liveKitTtsTrackName(
      targetSpeakerRole,
      sampleRate,
      targetLegId,
    );
    const track = this.options.rtc.LocalAudioTrack.createAudioTrack(
      trackName,
      source,
    );
    const publishOptions = new this.options.rtc.TrackPublishOptions();
    publishOptions.source = this.options.rtc.TrackSource.SOURCE_MICROPHONE;
    const publication = await participant.publishTrack(track, publishOptions);
    if (this.options.trackAccess) {
      if (typeof publication.sid !== "string" || !publication.sid) {
        throw new Error("LiveKit TTS publication is missing a track SID");
      }
      await this.options.trackAccess.authorizeTrack({
        targetLegId,
        targetSpeakerRole,
        trackSid: publication.sid,
        trackName,
      });
    }
    return { source, sampleRate };
  }
}

function trackKey(targetLegId: string, sampleRate: 16000 | 24000) {
  return `${targetLegId}:${sampleRate}`;
}

export function liveKitTtsTrackName(
  targetSpeakerRole: "host" | "guest",
  sampleRate: 16000 | 24000,
  targetLegId: string,
) {
  return `translation-tts-${targetSpeakerRole}-${sampleRate}.${
    Buffer.from(targetLegId).toString("base64url")
  }`;
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

function assertCurrentPlayback(
  generations: Map<string, number>,
  input: Parameters<CallTtsAudioSink["play"]>[0],
) {
  if (input.signal.aborted ||
    generations.get(input.targetLegId) !== input.generation) {
    throw new Error("LiveKit playback interrupted");
  }
}
