import { voice } from "@livekit/agents";
import {
  AudioSource,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
  type AudioFrame,
  type Room,
} from "@livekit/rtc-node";
import {
  voiceAgentTargetTrackName,
  waitForTargetAudioSubscription,
} from "./livekit-target-audio-support.js";

interface AudioSourceLike {
  captureFrame(frame: AudioFrame): Promise<void>;
  clearQueue(): void;
  waitForPlayout(): Promise<void>;
  close(): Promise<void>;
}

interface LocalTrackLike {
  close(flush?: boolean): Promise<void>;
}

export interface TargetAudioRtc {
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

export interface VoiceAgentAudioCapacityEvidence {
  code: "voice_agent_pending_audio_capacity_exceeded";
  pendingAudioMs: number;
  pendingAudioChunks: number;
  maxPendingAudioMs: number;
  maxPendingAudioChunks: number;
}

export class VoiceAgentAudioCapacityError extends Error {
  readonly name = "VoiceAgentAudioCapacityError";

  constructor(readonly evidence: VoiceAgentAudioCapacityEvidence) {
    super("Voice Agent pending audio capacity exceeded");
  }
}

export interface VoiceAgentPlaybackObservation {
  started: Promise<{ startedAtMs: number; audible: boolean }>;
  finished: Promise<{
    finishedAtMs: number;
    playbackPosition: number;
    interrupted: boolean;
  }>;
  cancel(): void;
}

interface PendingPlaybackObservation {
  started: boolean;
  finished: boolean;
  resolveStarted(value: { startedAtMs: number; audible: boolean }): void;
  resolveFinished(value: {
    finishedAtMs: number;
    playbackPosition: number;
    interrupted: boolean;
  }): void;
}

export class LiveKitTargetAudioOutput extends voice.AudioOutput {
  private readonly source: AudioSourceLike;
  private startPromise?: Promise<void>;
  private track?: LocalTrackLike;
  private activeDuration = 0;
  private firstFrame = true;
  private pendingCaptureDurationMs = 0;
  private pendingCaptureChunks = 0;
  private readonly maxPendingAudioMs: number;
  private readonly maxPendingAudioChunks: number;
  private readonly pending = new Set<{
    duration: number;
    finished: boolean;
    observation?: PendingPlaybackObservation;
  }>();
  private nextObservation?: PendingPlaybackObservation;
  private activeObservation?: PendingPlaybackObservation;

  constructor(private readonly options: {
    room: Room;
    publisherIdentity: string;
    targetParticipantIdentity: string;
    rtc?: TargetAudioRtc;
    maxPendingAudioMs?: number;
    maxPendingAudioChunks?: number;
    onCapacityExceeded?: (
      evidence: VoiceAgentAudioCapacityEvidence,
    ) => void | Promise<void>;
  }) {
    super(24_000);
    this.maxPendingAudioMs = options.maxPendingAudioMs ?? 6_000;
    this.maxPendingAudioChunks = options.maxPendingAudioChunks ?? 300;
    if (!Number.isInteger(this.maxPendingAudioMs) ||
      this.maxPendingAudioMs <= 0 ||
      !Number.isInteger(this.maxPendingAudioChunks) ||
      this.maxPendingAudioChunks <= 0) {
      throw new Error("Voice Agent pending audio limits must be positive integers");
    }
    const rtc = options.rtc ?? defaultRtc;
    this.source = new rtc.AudioSource(24_000, 1, this.maxPendingAudioMs);
  }

  start(signal: AbortSignal) {
    this.startPromise ??= this.publish(signal);
    return this.startPromise;
  }

  observeNextSegment(): VoiceAgentPlaybackObservation {
    if (this.nextObservation || this.activeObservation) {
      throw new Error("Target audio output already has a playback observer");
    }
    let resolveStarted!: (value: {
      startedAtMs: number;
      audible: boolean;
    }) => void;
    let resolveFinished!: (value: {
      finishedAtMs: number;
      playbackPosition: number;
      interrupted: boolean;
    }) => void;
    const observation: PendingPlaybackObservation = {
      started: false,
      finished: false,
      resolveStarted: (value) => resolveStarted(value),
      resolveFinished: (value) => resolveFinished(value),
    };
    const started = new Promise<{
      startedAtMs: number;
      audible: boolean;
    }>((resolve) => {
      resolveStarted = resolve;
    });
    const finished = new Promise<{
      finishedAtMs: number;
      playbackPosition: number;
      interrupted: boolean;
    }>((resolve) => {
      resolveFinished = resolve;
    });
    this.nextObservation = observation;
    return {
      started,
      finished,
      cancel: () => this.cancelObservation(observation),
    };
  }

  override async captureFrame(frame: AudioFrame) {
    if (!this.startPromise) throw new Error("Target audio output is not started");
    await this.startPromise;
    if (frame.sampleRate !== 24_000 || frame.channels !== 1) {
      throw new Error("Target audio output requires 24kHz mono PCM");
    }
    const frameDurationMs = frame.samplesPerChannel / frame.sampleRate * 1000;
    this.reservePendingCapture(frameDurationMs);
    try {
      await super.captureFrame(frame);
      if (this.firstFrame) {
        this.firstFrame = false;
        const startedAtMs = Date.now();
        this.onPlaybackStarted(startedAtMs);
        this.activeObservation = this.nextObservation;
        this.nextObservation = undefined;
        if (this.activeObservation && !this.activeObservation.started) {
          this.activeObservation.started = true;
          this.activeObservation.resolveStarted({
            startedAtMs,
            audible: true,
          });
        }
      }
      this.activeDuration += frame.samplesPerChannel / frame.sampleRate;
      await this.source.captureFrame(frame);
    } finally {
      this.releasePendingCapture(frameDurationMs);
    }
  }

  override flush() {
    super.flush();
    if (!this.activeDuration) return;
    const segment = {
      duration: this.activeDuration,
      finished: false,
      ...(this.activeObservation
        ? { observation: this.activeObservation }
        : {}),
    };
    this.activeDuration = 0;
    this.firstFrame = true;
    this.activeObservation = undefined;
    this.pending.add(segment);
    void this.source.waitForPlayout()
      .then(() => this.finish(segment, false))
      .catch(() => this.finish(segment, true));
  }

  override clearBuffer() {
    this.source.clearQueue();
    super.flush();
    if (this.activeDuration) {
      this.pending.add({
        duration: this.activeDuration,
        finished: false,
        ...(this.activeObservation
          ? { observation: this.activeObservation }
          : {}),
      });
      this.activeDuration = 0;
      this.firstFrame = true;
      this.activeObservation = undefined;
    }
    if (this.nextObservation) this.cancelObservation(this.nextObservation);
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
    await waitForTargetAudioSubscription(
      publication.waitForSubscription(),
      signal,
    );
  }

  private reservePendingCapture(frameDurationMs: number) {
    const pendingAudioMs = this.pendingCaptureDurationMs + frameDurationMs;
    const pendingAudioChunks = this.pendingCaptureChunks + 1;
    if (pendingAudioMs > this.maxPendingAudioMs ||
      pendingAudioChunks > this.maxPendingAudioChunks) {
      const evidence: VoiceAgentAudioCapacityEvidence = {
        code: "voice_agent_pending_audio_capacity_exceeded",
        pendingAudioMs,
        pendingAudioChunks,
        maxPendingAudioMs: this.maxPendingAudioMs,
        maxPendingAudioChunks: this.maxPendingAudioChunks,
      };
      this.clearBuffer();
      void Promise.resolve(this.options.onCapacityExceeded?.(evidence))
        .catch(() => undefined);
      throw new VoiceAgentAudioCapacityError(evidence);
    }
    this.pendingCaptureDurationMs = pendingAudioMs;
    this.pendingCaptureChunks = pendingAudioChunks;
  }

  private releasePendingCapture(frameDurationMs: number) {
    this.pendingCaptureDurationMs = Math.max(
      0,
      this.pendingCaptureDurationMs - frameDurationMs,
    );
    this.pendingCaptureChunks = Math.max(0, this.pendingCaptureChunks - 1);
  }

  private finish(
    segment: {
      duration: number;
      finished: boolean;
      observation?: PendingPlaybackObservation;
    },
    interrupted: boolean,
  ) {
    if (segment.finished) return;
    segment.finished = true;
    this.pending.delete(segment);
    const playbackPosition = interrupted ? 0 : segment.duration;
    this.onPlaybackFinished({
      playbackPosition,
      interrupted,
    });
    this.finishObservation(segment.observation, playbackPosition, interrupted);
  }

  private cancelObservation(observation: PendingPlaybackObservation) {
    if (this.nextObservation === observation) this.nextObservation = undefined;
    if (this.activeObservation === observation) this.activeObservation = undefined;
    this.finishObservation(observation, 0, true);
  }

  private finishObservation(
    observation: PendingPlaybackObservation | undefined,
    playbackPosition: number,
    interrupted: boolean,
  ) {
    if (!observation || observation.finished) return;
    const finishedAtMs = Date.now();
    if (!observation.started) {
      observation.started = true;
      observation.resolveStarted({
        startedAtMs: finishedAtMs,
        audible: false,
      });
    }
    observation.finished = true;
    observation.resolveFinished({
      finishedAtMs,
      playbackPosition,
      interrupted,
    });
  }
}
