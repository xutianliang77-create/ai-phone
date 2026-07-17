import {
  AudioIngestRingBuffer,
  type AudioIngestMetrics,
} from "./audio-ingest-ring-buffer.js";
import {
  int16Base64,
  normalizeSampleRate,
} from "./livekit-call-audio-utils.js";
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

  constructor(private readonly options: LiveKitCallAudioTrackRuntimeOptions) {
    this.reader = options.stream.getReader();
    this.queue = new AudioIngestRingBuffer<CallAudioFrame>({
      callId: options.callId,
      legId: options.legId,
      speakerRole: options.speakerRole,
      capacityFrames: options.capacityFrames,
      onMetrics: options.onMetrics,
    });
  }

  async run() {
    await this.options.pipelineReady;
    await Promise.all([this.readAudioStream(), this.consumeAudio()]);
    if (!this.options.isStopped()) this.queue.report("drained");
  }

  stop(discardPending: boolean) {
    this.queue.close({ discardPending });
    void this.reader.cancel().catch(() => undefined);
  }

  private async readAudioStream() {
    try {
      while (!this.options.isStopped()) {
        const result = await this.reader.read();
        if (result.done) break;
        this.queue.enqueue({
          type: "audio.frame",
          sessionId: this.options.callId,
          speakerRole: this.options.speakerRole,
          sequence: this.options.nextSequence(),
          timestampMs: this.options.nowMs?.() ?? Date.now(),
          format: "pcm16",
          sampleRate: normalizeSampleRate(result.value.sampleRate),
          data: int16Base64(result.value.data),
        });
      }
    } catch (error) {
      if (!this.options.isStopped()) throw error;
    } finally {
      this.queue.close({ discardPending: this.options.isStopped() });
      this.reader.releaseLock();
    }
  }

  private async consumeAudio() {
    while (!this.options.isStopped()) {
      const frame = await this.queue.dequeue();
      if (!frame) return;
      try {
        await this.options.worker.processAudioFrame(frame);
        this.queue.markProcessed(frame);
      } catch (error) {
        this.queue.markFailed();
        throw error;
      }
    }
  }
}
