import type {
  RealtimeVoiceConfig,
  ServerRealtimeEvent,
  TranslationEvent,
} from "@translation/contracts";
import type { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";
import { logRealtimeTtsFailure } from "./http-tts-synthesizer.js";

interface RealtimeTtsOutputQueueOptions {
  sessionId: string;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  synthesizer: Pick<
    HttpTtsSynthesizer,
    "enabled" | "synthesize" | "cancelSession" | "closeSession"
  >;
  isSessionActive: () => boolean;
  maxPendingOutputs?: number;
  onDrop?: (event: TranslationEvent) => void;
}

export class RealtimeTtsOutputQueue {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private pendingOutputs = 0;
  private droppedOutputs = 0;

  constructor(private readonly options: RealtimeTtsOutputQueueOptions) {}

  enqueue(event: ServerRealtimeEvent, send: (event: ServerRealtimeEvent) => void) {
    if (event.type !== "translation.final"
      || !this.options.voiceOutput
      || !this.options.synthesizer.enabled
      || this.closed) return;
    if (this.pendingOutputs >= (this.options.maxPendingOutputs ?? 32)) {
      this.droppedOutputs += 1;
      this.options.onDrop?.(event);
      return;
    }
    this.pendingOutputs += 1;
    const generation = this.generation;
    this.tail = this.tail.then(async () => {
      if (!this.canEmit(generation)) return;
      try {
        const audio = await this.options.synthesizer.synthesize(event, this.options.voice);
        if (audio && this.canEmit(generation)) send(audio);
      } catch (error) {
        if (this.canEmit(generation)) {
          logRealtimeTtsFailure(event.sessionId, event.segmentId, error);
        }
      }
    }).finally(() => {
      this.pendingOutputs = Math.max(0, this.pendingOutputs - 1);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.resetGeneration();
    this.options.synthesizer.closeSession(this.options.sessionId);
  }

  cancelPending() {
    if (this.closed) return;
    this.resetGeneration();
    this.options.synthesizer.cancelSession(this.options.sessionId);
  }

  private resetGeneration() {
    this.generation += 1;
    this.tail = Promise.resolve();
  }

  async drain() {
    await this.tail;
  }

  diagnostics() {
    return {
      pendingOutputs: this.pendingOutputs,
      droppedOutputs: this.droppedOutputs,
    };
  }

  private canEmit(generation: number) {
    return !this.closed
      && generation === this.generation
      && this.options.isSessionActive();
  }
}
