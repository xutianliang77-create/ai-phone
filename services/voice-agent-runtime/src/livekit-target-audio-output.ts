import { voice } from "@livekit/agents";
import {
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type AudioFrame,
  type Room,
} from "@livekit/rtc-node";

interface AudioSourceLike {
  captureFrame(frame: AudioFrame): Promise<void>;
  clearQueue(): void;
  waitForPlayout(): Promise<void>;
  close(): Promise<void>;
}

interface LocalTrackLike {
  close(flush?: boolean): Promise<void>;
}

interface TargetAudioRtc {
  AudioSource: new (
    sampleRate: number,
    channels: number,
    queueSizeMs?: number,
  ) => AudioSourceLike;
  LocalAudioTrack: {
    createAudioTrack(name: string, source: AudioSourceLike): LocalTrackLike;
  };
  TrackPublishOptions: new () => { source?: unknown };
  TrackSource: { SOURCE_MICROPHONE: unknown };
}

const defaultRtc = {
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
} as unknown as TargetAudioRtc;

export const liveKitVoiceAgentRoomOutputOptions = {
  audioEnabled: false,
  transcriptionEnabled: true,
  syncTranscription: false,
} as const;

const liveKitDefaultRoomOutputOptions = {
  audioEnabled: true,
  transcriptionEnabled: true,
  syncTranscription: true,
} as const;

export class LiveKitTargetAudioOutput extends voice.AudioOutput {
  private readonly source: AudioSourceLike;
  private startPromise?: Promise<void>;
  private track?: LocalTrackLike;
  private activeDuration = 0;
  private firstFrame = true;
  private readonly pending = new Set<{
    duration: number;
    finished: boolean;
  }>();

  constructor(private readonly options: {
    room: Room;
    publisherIdentity: string;
    targetParticipantIdentity: string;
    rtc?: TargetAudioRtc;
    queueSizeMs?: number;
  }) {
    super(24_000);
    const rtc = options.rtc ?? defaultRtc;
    this.source = new rtc.AudioSource(24_000, 1, options.queueSizeMs);
  }

  start(signal: AbortSignal) {
    this.startPromise ??= this.publish(signal);
    return this.startPromise;
  }

  override async captureFrame(frame: AudioFrame) {
    if (!this.startPromise) throw new Error("Target audio output is not started");
    await this.startPromise;
    if (frame.sampleRate !== 24_000 || frame.channels !== 1) {
      throw new Error("Target audio output requires 24kHz mono PCM");
    }
    await super.captureFrame(frame);
    if (this.firstFrame) {
      this.firstFrame = false;
      this.onPlaybackStarted(Date.now());
    }
    this.activeDuration += frame.samplesPerChannel / frame.sampleRate;
    await this.source.captureFrame(frame);
  }

  override flush() {
    super.flush();
    if (!this.activeDuration) return;
    const segment = { duration: this.activeDuration, finished: false };
    this.activeDuration = 0;
    this.firstFrame = true;
    this.pending.add(segment);
    void this.source.waitForPlayout()
      .then(() => this.finish(segment, false))
      .catch(() => this.finish(segment, true));
  }

  override clearBuffer() {
    this.source.clearQueue();
    super.flush();
    if (this.activeDuration) {
      this.pending.add({ duration: this.activeDuration, finished: false });
      this.activeDuration = 0;
      this.firstFrame = true;
    }
    for (const segment of [...this.pending]) this.finish(segment, true);
  }

  async close() {
    this.clearBuffer();
    await this.track?.close(false).catch(() => undefined);
    await this.source.close();
  }

  private async publish(signal: AbortSignal) {
    const participant = this.options.room.localParticipant;
    if (!participant || participant.identity !== this.options.publisherIdentity) {
      throw new Error("Voice Agent publisher identity mismatch");
    }
    const rtc = this.options.rtc ?? defaultRtc;
    const name = voiceAgentTargetTrackName(
      this.options.targetParticipantIdentity,
    );
    const track = rtc.LocalAudioTrack.createAudioTrack(name, this.source);
    this.track = track;
    const publishOptions = new rtc.TrackPublishOptions();
    publishOptions.source = rtc.TrackSource.SOURCE_MICROPHONE;
    const publication = await participant.publishTrack(
      track as never,
      publishOptions as never,
    );
    await waitForSubscription(publication.waitForSubscription(), signal);
  }

  private finish(
    segment: { duration: number; finished: boolean },
    interrupted: boolean,
  ) {
    if (segment.finished) return;
    segment.finished = true;
    this.pending.delete(segment);
    this.onPlaybackFinished({
      playbackPosition: interrupted ? 0 : segment.duration,
      interrupted,
    });
  }
}

export function configureVoiceAgentTargetAudio(
  session: { output: { audio: voice.AudioOutput | null } },
  options: ConstructorParameters<typeof LiveKitTargetAudioOutput>[0],
) {
  const output = new LiveKitTargetAudioOutput(options);
  session.output.audio = output;
  return output;
}

export function configureVoiceAgentSessionAudio(
  session: { output: { audio: voice.AudioOutput | null } },
  input: {
    room: Room;
    telephonyProvider: "air780_volte" | "livekit_sip";
    publisherIdentity: string;
    targetParticipantIdentity: string;
    rtc?: TargetAudioRtc;
  },
) {
  if (input.telephonyProvider !== "air780_volte") {
    return {
      output: undefined,
      abortController: undefined,
      roomOutputOptions: liveKitDefaultRoomOutputOptions,
    };
  }
  const abortController = new AbortController();
  const output = configureVoiceAgentTargetAudio(session, {
    room: input.room,
    publisherIdentity: input.publisherIdentity,
    targetParticipantIdentity: input.targetParticipantIdentity,
    ...(input.rtc ? { rtc: input.rtc } : {}),
  });
  return {
    output,
    abortController,
    roomOutputOptions: liveKitVoiceAgentRoomOutputOptions,
  };
}

export function voiceAgentTargetTrackName(targetParticipantIdentity: string) {
  if (!targetParticipantIdentity ||
    Buffer.byteLength(targetParticipantIdentity) > 320) {
    throw new Error("Invalid Voice Agent target participant identity");
  }
  return `translation-tts-guest-24000.${
    Buffer.from(targetParticipantIdentity).toString("base64url")
  }`;
}

async function waitForSubscription(
  subscribed: Promise<unknown>,
  signal: AbortSignal,
) {
  if (signal.aborted) throw abortError();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([subscribed, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function abortError() {
  const error = new Error("Target audio output start aborted");
  error.name = "AbortError";
  return error;
}
