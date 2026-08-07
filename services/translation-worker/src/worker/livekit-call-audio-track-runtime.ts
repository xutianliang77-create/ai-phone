import {
  AudioIngestRingBuffer,
  assertLosslessAudioMetrics,
  type AudioIngestOverflowPolicy,
  type AudioIngestMetrics,
} from "./audio-ingest-ring-buffer.js";
import {
  int16Base64,
  normalizeSampleRate,
} from "./livekit-call-audio-utils.js";
import { isCallRoomEndedError } from "./call-room-event-client.js";
import type { RtcAudioFrame } from "./livekit-call-audio-source-types.js";
import type {
  CallAudioFrame,
  CallAudioSpeakerRole,
  CallSpeechPipeline,
} from "./types.js";

interface LiveKitCallAudioTrackRuntimeOptions {
  callId: string;
  legId: string;
  speakerRole: CallAudioSpeakerRole;
  stream: ReadableStream<RtcAudioFrame>;
  capacityFrames: number;
  overflowPolicy?: AudioIngestOverflowPolicy;
  pipelineReady: Promise<void>;
  worker: CallSpeechPipeline;
  nextSequence: () => number;
  isStopped: () => boolean;
  onMetrics?: (metrics: AudioIngestMetrics) => void;
  nowMs?: () => number;
}

export class LiveKitCallAudioTrackRuntime {
  private readonly reader: ReadableStreamDefaultReader<RtcAudioFrame>;
  private readonly queue: AudioIngestRingBuffer<CallAudioFrame>;
  private stopped = false;

  constructor(private readonly options: LiveKitCallAudioTrackRuntimeOptions) {
    this.reader = options.stream.getReader();
    this.queue = new AudioIngestRingBuffer<CallAudioFrame>({
      callId: options.callId,
      legId: options.legId,
      speakerRole: options.speakerRole,
      capacityFrames: options.capacityFrames,
      overflowPolicy: options.overflowPolicy ?? "reject_newest",
      onMetrics: options.onMetrics,
    });
  }

  async run() {
    await this.options.pipelineReady;
    await Promise.all([this.readAudioStream(), this.consumeAudio()]);
    if (!this.isStopped()) {
      const metrics = this.queue.metrics("drained");
      this.queue.report("drained");
      if (this.options.overflowPolicy !== "drop_oldest") {
        assertLosslessAudioMetrics(metrics);
      }
    }
  }

  stop(discardPending: boolean) {
    this.stopped = true;
    this.queue.close({ discardPending });
    void this.reader.cancel().catch(() => undefined);
  }

  private async readAudioStream() {
    try {
      while (!this.isStopped()) {
        const result = await this.reader.read();
        if (result.done) break;
        const accepted = this.queue.enqueue({
          type: "audio.frame",
          sessionId: this.options.callId,
          speakerRole: this.options.speakerRole,
          sequence: this.options.nextSequence(),
          timestampMs: this.options.nowMs?.() ?? Date.now(),
          format: "pcm16",
          sampleRate: normalizeSampleRate(result.value.sampleRate),
          data: int16Base64(result.value.data),
        });
        if (!accepted) {
          throw new Error("Audio ingest backpressure rejected newest frame");
        }
      }
    } catch (error) {
      if (!this.isStopped()) throw error;
    } finally {
      this.queue.close({ discardPending: this.isStopped() });
      this.reader.releaseLock();
    }
  }

  private async consumeAudio() {
    while (!this.isStopped()) {
      const frame = await this.queue.dequeue();
      if (!frame) return;
      try {
        await this.options.worker.processAudioFrame(frame);
        this.queue.markProcessed(frame);
      } catch (error) {
        if (isCallRoomEndedError(error)) {
          this.queue.markProcessed(frame);
          throw error;
        }
        this.queue.markFailed();
        throw error;
      }
    }
  }

  private isStopped() {
    return this.stopped || this.options.isStopped();
  }
}
