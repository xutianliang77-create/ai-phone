import type { CallAudioSpeakerRole } from "./types.js";

export type AudioIngestMetricEvent =
  | "high_watermark"
  | "backpressure"
  | "sequence_gap"
  | "drained"
  | "stopped";

export interface AudioIngestMetrics {
  event: AudioIngestMetricEvent;
  callId: string;
  legId: string;
  speakerRole: CallAudioSpeakerRole;
  dropPolicy: "drop_oldest";
  capacityFrames: number;
  receivedFrames: number;
  dequeuedFrames: number;
  processedFrames: number;
  failedFrames: number;
  inFlightFrames: number;
  droppedFrames: number;
  overflowDroppedFrames: number;
  shutdownDiscardedFrames: number;
  sequenceGapFrames: number;
  queueDepthFrames: number;
  highWatermarkFrames: number;
  backpressureEvents: number;
  firstReceivedSequence?: number;
  lastReceivedSequence?: number;
  lastProcessedSequence?: number;
}

interface AudioIngestRingBufferOptions {
  callId: string;
  legId: string;
  speakerRole: CallAudioSpeakerRole;
  capacityFrames: number;
  onMetrics?: (metrics: AudioIngestMetrics) => void;
}

export class AudioIngestRingBuffer<T extends { sequence: number }> {
  private readonly buffer: Array<T | undefined>;
  private head = 0;
  private size = 0;
  private closed = false;
  private waiting: ((frame: T | null) => void) | null = null;
  private receivedFrames = 0;
  private dequeuedFrames = 0;
  private processedFrames = 0;
  private failedFrames = 0;
  private overflowDroppedFrames = 0;
  private shutdownDiscardedFrames = 0;
  private sequenceGapFrames = 0;
  private highWatermarkFrames = 0;
  private backpressureEvents = 0;
  private firstReceivedSequence: number | undefined;
  private lastReceivedSequence: number | undefined;
  private lastProcessedSequence: number | undefined;
  private stoppedReported = false;

  constructor(private readonly options: AudioIngestRingBufferOptions) {
    if (!Number.isInteger(options.capacityFrames) || options.capacityFrames < 1) {
      throw new Error("Audio ingest ring buffer capacity must be a positive integer");
    }
    this.buffer = new Array<T | undefined>(options.capacityFrames);
  }

  enqueue(frame: T) {
    if (this.closed) return false;
    this.receivedFrames += 1;
    this.firstReceivedSequence ??= frame.sequence;
    this.lastReceivedSequence = frame.sequence;

    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      this.dequeuedFrames += 1;
      resolve(frame);
      return true;
    }

    if (this.size === this.buffer.length) {
      this.buffer[this.head] = frame;
      this.head = (this.head + 1) % this.buffer.length;
      this.overflowDroppedFrames += 1;
      this.backpressureEvents += 1;
      this.emit("backpressure");
      return true;
    }

    const tail = (this.head + this.size) % this.buffer.length;
    this.buffer[tail] = frame;
    this.size += 1;
    if (this.size > this.highWatermarkFrames) {
      this.highWatermarkFrames = this.size;
      this.emit("high_watermark");
    }
    return true;
  }

  dequeue(): Promise<T | null> {
    if (this.size > 0) return Promise.resolve(this.takeOldest());
    if (this.closed) return Promise.resolve(null);
    if (this.waiting) throw new Error("Audio ingest ring buffer supports one consumer");
    return new Promise<T | null>((resolve) => {
      this.waiting = resolve;
    });
  }

  markProcessed(frame: T) {
    const previous = this.lastProcessedSequence;
    const first = this.firstReceivedSequence ?? frame.sequence;
    const gap = previous === undefined
      ? Math.max(0, frame.sequence - first)
      : Math.max(0, frame.sequence - previous - 1);
    this.processedFrames += 1;
    this.lastProcessedSequence = frame.sequence;
    if (gap > 0) {
      this.sequenceGapFrames += gap;
      this.emit("sequence_gap");
    }
  }

  markFailed() {
    this.failedFrames += 1;
  }

  close(options: { discardPending: boolean }) {
    if (!options.discardPending && this.closed) return;
    this.closed = true;
    if (options.discardPending) {
      this.shutdownDiscardedFrames += this.size;
      this.clearBuffer();
    }
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(null);
    }
    if (options.discardPending && !this.stoppedReported) {
      this.stoppedReported = true;
      this.emit("stopped");
    }
  }

  report(event: AudioIngestMetricEvent) {
    this.emit(event);
  }

  metrics(event: AudioIngestMetricEvent): AudioIngestMetrics {
    return {
      event,
      callId: this.options.callId,
      legId: this.options.legId,
      speakerRole: this.options.speakerRole,
      dropPolicy: "drop_oldest",
      capacityFrames: this.buffer.length,
      receivedFrames: this.receivedFrames,
      dequeuedFrames: this.dequeuedFrames,
      processedFrames: this.processedFrames,
      failedFrames: this.failedFrames,
      inFlightFrames:
        this.dequeuedFrames - this.processedFrames - this.failedFrames,
      droppedFrames:
        this.overflowDroppedFrames + this.shutdownDiscardedFrames,
      overflowDroppedFrames: this.overflowDroppedFrames,
      shutdownDiscardedFrames: this.shutdownDiscardedFrames,
      sequenceGapFrames: this.sequenceGapFrames,
      queueDepthFrames: this.size,
      highWatermarkFrames: this.highWatermarkFrames,
      backpressureEvents: this.backpressureEvents,
      ...(this.firstReceivedSequence === undefined
        ? {}
        : { firstReceivedSequence: this.firstReceivedSequence }),
      ...(this.lastReceivedSequence === undefined
        ? {}
        : { lastReceivedSequence: this.lastReceivedSequence }),
      ...(this.lastProcessedSequence === undefined
        ? {}
        : { lastProcessedSequence: this.lastProcessedSequence }),
    };
  }

  private takeOldest() {
    const frame = this.buffer[this.head];
    if (!frame) throw new Error("Audio ingest ring buffer is inconsistent");
    this.buffer[this.head] = undefined;
    this.head = (this.head + 1) % this.buffer.length;
    this.size -= 1;
    this.dequeuedFrames += 1;
    return frame;
  }

  private clearBuffer() {
    this.buffer.fill(undefined);
    this.head = 0;
    this.size = 0;
  }

  private emit(event: AudioIngestMetricEvent) {
    try {
      this.options.onMetrics?.(this.metrics(event));
    } catch {
      // Observability must not apply backpressure to the media path.
    }
  }
}
