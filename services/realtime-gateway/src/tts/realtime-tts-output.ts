import type {
  RealtimeVoiceConfig,
  ServerRealtimeEvent,
  TranslationEvent,
} from "@translation/contracts";
import type { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";
import { logRealtimeTtsFailure } from "./http-tts-synthesizer.js";
import { buildError } from "../protocol/outgoing-event-builder.js";

interface RealtimeTtsOutputQueueOptions {
  sessionId: string;
  voiceOutput: boolean;
  voice?: RealtimeVoiceConfig;
  synthesizer: Pick<
    HttpTtsSynthesizer,
    "enabled" | "synthesizeStream" | "cancelSession" | "closeSession"
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

  setVoiceOutput(enabled: boolean, presetId?: string) {
    if (this.closed || (enabled && !this.options.synthesizer.enabled)) return false;
    if (this.options.voiceOutput === enabled &&
        (!presetId || (this.options.voice?.mode === "preset" &&
          this.options.voice.presetId === presetId))) return true;
    this.resetGeneration();
    this.options.voiceOutput = enabled;
    if (presetId) this.options.voice = { mode: "preset", presetId };
    return true;
  }

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
        for await (const audio of this.options.synthesizer.synthesizeStream(
          event,
          this.options.voice,
        )) {
          if (!this.canEmit(generation)) return;
          send(audio);
        }
      } catch (error) {
        if (this.canEmit(generation)) {
          logRealtimeTtsFailure(event.sessionId, event.segmentId, error);
          const reason = error instanceof Error ? error.message : "TTS provider failed";
          send(buildError("provider_unavailable", `语音合成失败：${reason}。字幕已保留`, {
            sessionId: event.sessionId, stage: "tts", retryable: true,
          }));
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
