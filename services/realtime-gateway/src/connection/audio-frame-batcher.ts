import type { AudioFrame, ServerRealtimeEvent } from "@translation/contracts";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";

interface AudioFrameBatcherOptions {
  sessionId: string;
  provider: RealtimeProvider;
  send: (event: ServerRealtimeEvent) => void;
  onError: (error: unknown) => void;
  batchDelayMs?: number;
  maxBatchAudioMs?: number;
  maxPendingAudioMs?: number;
}

const DEFAULT_BATCH_DELAY_MS = 120;
const DEFAULT_MAX_BATCH_AUDIO_MS = 800;
const DEFAULT_MAX_PENDING_AUDIO_MS = 6000;
const DROP_WARNING_INTERVAL_MS = 1000;
const DROP_WARNING_FRAME_THRESHOLD = 25;

export class AudioFrameBatcher {
  private readonly batchDelayMs: number;
  private readonly maxBatchAudioMs: number;
  private readonly maxPendingAudioMs: number;
  private pending: AudioFrame[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private processing = Promise.resolve();
  private processQueued = false;
  private forceNextProcess = false;
  private droppedSinceLastWarning = 0;
  private lastDropWarningAt = 0;
  private accepting = true;
  private closed = false;

  constructor(private readonly options: AudioFrameBatcherOptions) {
    this.batchDelayMs = options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
    this.maxBatchAudioMs = options.maxBatchAudioMs ?? DEFAULT_MAX_BATCH_AUDIO_MS;
    this.maxPendingAudioMs = options.maxPendingAudioMs ?? DEFAULT_MAX_PENDING_AUDIO_MS;
  }

  enqueue(frame: AudioFrame) {
    if (!this.accepting || this.closed) return;
    if (!this.canAppend(frame)) return;

    this.pending.push(frame);
    this.trimPendingAudio();
    this.scheduleProcessing();
  }

  pauseAccepting() {
    this.accepting = false;
    this.clearTimer();
  }

  resumeAccepting() {
    if (!this.closed) this.accepting = true;
  }

  stopAccepting() {
    this.accepting = false;
    this.clearTimer();
  }

  async flush() {
    this.clearTimer();
    await this.queueProcessing(true);
  }

  async close() {
    this.closed = true;
    this.stopAccepting();
    await this.flush();
  }

  private canAppend(frame: AudioFrame) {
    const previous = this.pending.at(-1);
    if (!previous) return true;
    const canAppend =
      previous.sessionId === frame.sessionId &&
      previous.sampleRate === frame.sampleRate &&
      previous.format === frame.format;
    if (!canAppend) {
      realtimeLogger.warn({
        sessionId: this.options.sessionId,
        sequence: frame.sequence,
      }, "Dropped incompatible realtime audio frame");
    }
    return canAppend;
  }

  private trimPendingAudio() {
    let pendingMs = totalDurationMs(this.pending);
    let dropped = 0;
    while (pendingMs > this.maxPendingAudioMs && this.pending.length > 1) {
      const frame = this.pending.shift();
      if (!frame) break;
      pendingMs -= frameDurationMs(frame);
      dropped += 1;
    }
    if (dropped > 0) {
      this.warnDroppedFrames(dropped, pendingMs);
    }
  }

  private warnDroppedFrames(dropped: number, pendingMs: number) {
    this.droppedSinceLastWarning += dropped;
    const now = Date.now();
    const shouldWarn =
      now - this.lastDropWarningAt >= DROP_WARNING_INTERVAL_MS ||
      this.droppedSinceLastWarning >= DROP_WARNING_FRAME_THRESHOLD;
    if (!shouldWarn) return;

    realtimeLogger.warn({
      sessionId: this.options.sessionId,
      dropped: this.droppedSinceLastWarning,
      pendingMs: Math.round(pendingMs),
    }, "Dropped stale realtime audio frames under ASR backpressure");
    this.droppedSinceLastWarning = 0;
    this.lastDropWarningAt = now;
  }

  private scheduleProcessing() {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.queueProcessing(false);
    }, this.batchDelayMs);
  }

  private queueProcessing(force: boolean) {
    this.forceNextProcess = this.forceNextProcess || force;
    if (this.processQueued) return this.processing;

    this.processQueued = true;
    this.processing = this.processing
      .then(async () => {
        const forceRun = this.forceNextProcess;
        this.processQueued = false;
        this.forceNextProcess = false;
        await this.processPending(forceRun);
      })
      .catch((error) => {
        this.processQueued = false;
        this.forceNextProcess = false;
        this.options.onError(error);
      });
    return this.processing;
  }

  private async processPending(force: boolean) {
    if (force) {
      while (this.pending.length > 0) await this.sendNextBatch(true);
      return;
    }

    await this.sendNextBatch(false);
    if (this.pending.length > 0 && this.accepting) this.scheduleProcessing();
  }

  private async sendNextBatch(force: boolean) {
    const batch = this.takeBatch(force);
    if (!batch) return;
    for await (const outgoing of this.options.provider.sendAudio(batch)) {
      this.options.send(outgoing);
    }
  }

  private takeBatch(force: boolean) {
    if (this.pending.length === 0) return null;
    if (force) return mergeFrames(this.pending.splice(0));

    const frames: AudioFrame[] = [];
    let durationMs = 0;
    while (this.pending.length > 0) {
      const next = this.pending[0];
      const nextMs = frameDurationMs(next);
      if (frames.length > 0 && durationMs + nextMs > this.maxBatchAudioMs) break;
      frames.push(this.pending.shift() as AudioFrame);
      durationMs += nextMs;
    }
    return mergeFrames(frames);
  }

  private clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function mergeFrames(frames: AudioFrame[]) {
  if (frames.length === 1) return frames[0];
  const first = frames[0];
  const last = frames.at(-1) ?? first;
  const buffers = frames.map((frame) => Buffer.from(frame.data, "base64"));
  return {
    ...first,
    sequence: last.sequence,
    timestampMs: last.timestampMs,
    data: Buffer.concat(buffers).toString("base64"),
  };
}

function totalDurationMs(frames: AudioFrame[]) {
  return frames.reduce((sum, frame) => sum + frameDurationMs(frame), 0);
}

function frameDurationMs(frame: AudioFrame) {
  const byteLength = Buffer.byteLength(frame.data, "base64");
  return byteLength / 2 / frame.sampleRate * 1000;
}
