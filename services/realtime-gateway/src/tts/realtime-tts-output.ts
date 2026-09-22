import type {
  RealtimeVoiceConfig,
  ServerRealtimeEvent,
  TranslationEvent,
} from "@translation/contracts";
import type { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";
import { logRealtimeTtsFailure } from "./http-tts-synthesizer.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import {PublicSpeechError} from "./public-speech.js";

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
  acceptVoice?: (enabled:boolean,presetId?:string)=>boolean;
}
interface PendingOutput {
  event: TranslationEvent;
  send: (event: ServerRealtimeEvent) => void;
  generation: number;
  started: boolean;
}

export class RealtimeTtsOutputQueue {
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private readonly pending = new Set<PendingOutput>();
  private active?: PendingOutput;
  private droppedOutputs = 0;
  private suspended = false;
  /** Last accepted translation revision for each segment.  This belongs to
   * the inherited output queue, so a later correction cannot speak an older
   * translation while the session remains active. */
  private readonly revisionBySegment = new Map<string, number>();
  private readonly operations = new Set<Promise<void>>();

  constructor(private readonly options: RealtimeTtsOutputQueueOptions) {}

  setVoiceOutput(enabled: boolean, presetId?: string) {
    if (this.closed || (enabled && !this.options.synthesizer.enabled)) return false;
    if(this.options.acceptVoice&&!this.options.acceptVoice(enabled,presetId))return false;
    if (this.options.voiceOutput === enabled &&
        (!presetId || (this.options.voice?.mode === "preset" &&
          this.options.voice.presetId === presetId))) return true;
    this.resetGeneration();
    this.options.synthesizer.cancelSession(this.options.sessionId);
    this.options.voiceOutput = enabled;
    if (presetId) this.options.voice = { mode: "preset", presetId };
    return true;
  }

  enqueue(event: ServerRealtimeEvent, send: (event: ServerRealtimeEvent) => void) {
    if (event.type !== "translation.final" || event.sessionId !== this.options.sessionId
      || !this.options.voiceOutput
      || !this.options.synthesizer.enabled
      || this.closed || this.suspended) return;
    const revision = Number.isSafeInteger(event.revision) && event.revision! >= 0
      ? event.revision
      : undefined;
    const prior = revision === undefined
      ? undefined
      : this.revisionBySegment.get(event.segmentId);
    if (prior !== undefined && revision! <= prior) return;
    const queued = prior === undefined ? undefined : [...this.pending].find(item => !item.started && item.event.segmentId === event.segmentId);
    const replacesActive = prior !== undefined && this.active?.event.segmentId === event.segmentId;
    if (!queued && !replacesActive &&
        this.pending.size >= (this.options.maxPendingOutputs ?? 32)) {
      this.droppedOutputs += 1;
      this.options.onDrop?.(event);
      return;
    }
    if (revision !== undefined) this.revisionBySegment.set(event.segmentId, revision);
    if (queued && !replacesActive) {
      queued.event = event;
      queued.send = send;
      return;
    }
    if (replacesActive) {
      // Only this segment's active synthesis needs cancellation. Retain all
      // unrelated, not-yet-dispatched work without issuing duplicate calls.
      const retained = [...this.pending].filter(item => !item.started &&
        item.event.segmentId !== event.segmentId && this.isCurrentRevision(item.event));
      this.cancelPending();
      this.schedule(event, send);
      for (const item of retained) this.schedule(item.event, item.send);
      return;
    }
    this.schedule(event, send);
  }

  private schedule(event: TranslationEvent, send: (event: ServerRealtimeEvent) => void) {
    const item: PendingOutput = { event, send, generation: this.generation, started: false };
    this.pending.add(item);
    this.tail = this.tail.then(async () => {
      if (!this.canEmit(item.generation) || !this.isCurrentRevision(item.event)) return;
      item.started = true;
      this.active = item;
      try {
        for await (const audio of this.options.synthesizer.synthesizeStream(
          item.event,
          this.options.voice,
        )) {
          if (!this.canEmit(item.generation) || !this.isCurrentRevision(item.event)) return;
          item.send(audio);
        }
      } catch (error) {
        if (this.canEmit(item.generation) && this.isCurrentRevision(item.event)) {
          logRealtimeTtsFailure(item.event.sessionId, item.event.segmentId, error);
          const reason = error instanceof Error ? error.message : "TTS provider failed";
          item.send(buildError("provider_unavailable", `语音合成失败：${reason}。字幕已保留`, {
            sessionId: item.event.sessionId, stage: "tts", retryable: !(error instanceof PublicSpeechError),
          }));
        }
      }
    }).finally(() => {
      // An old generation can release only its own identity, never a new slot.
      this.pending.delete(item);
      if (this.active === item) this.active = undefined;
    });
    const operation=this.tail;
    this.operations.add(operation);
    void operation.then(()=>this.operations.delete(operation),()=>this.operations.delete(operation));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.resetGeneration();
    this.options.synthesizer.closeSession(this.options.sessionId);
    this.revisionBySegment.clear();
  }

  cancelPending() {
    if (this.closed) return;
    this.resetGeneration();
    this.options.synthesizer.cancelSession(this.options.sessionId);
  }

  /** Public control barrier: cancelled tail translations must not restart speech
   * while ASR/MT are still flushing under an active server lease. */
  suspend() {if(this.closed)return;this.suspended=true;this.cancelPending();}
  resume() {if(!this.closed)this.suspended=false;}
  async drainInFlight() {await Promise.all([...this.operations]);}

  private resetGeneration() {
    this.generation += 1;
    this.tail = Promise.resolve();
    this.pending.clear();
    this.active = undefined;
  }

  async drain() {
    await this.tail;
  }

  diagnostics() {
    return {
      pendingOutputs: this.pending.size,
      droppedOutputs: this.droppedOutputs,
    };
  }

  private isCurrentRevision(event: TranslationEvent) {
    return event.revision === undefined || this.revisionBySegment.get(event.segmentId) === event.revision;
  }

  private canEmit(generation: number) {
    return !this.closed
      && !this.suspended
      && generation === this.generation
      && this.options.isSessionActive();
  }
}
