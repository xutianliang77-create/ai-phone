import type {
  RealtimeFlushSummary,
  RealtimeSessionDiagnosticsDto,
  ServerRealtimeEvent,
  SessionEndReason,
} from "@translation/contracts";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import {
  getSession,
  sessionBillableSeconds,
  transitionStatus,
} from "../sessions/session-manager.js";
import type { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { flushProviderSession } from "./session-control-handler.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";
import type {RealtimeTtsOutputQueue} from "../tts/realtime-tts-output.js";
import {logPublicSessionEnd} from "../metrics/public-asr-boundary-trace.js";

interface RealtimeSessionFinalizerOptions {
  sessionId: string;
  provider: RealtimeProvider;
  audioBatcher: Pick<AudioFrameBatcher, "stopAccepting" | "flush"> &
    Partial<Pick<AudioFrameBatcher, "diagnostics">>;
  send: (event: ServerRealtimeEvent) => void;
  drainSessionSync: () => Promise<void>;
  flushTracker: RealtimeFlushTracker;
  onError: (stage: "audio" | "provider", error: unknown) => void;
  confirmed?:{beforeFlush:()=>Promise<void>;stopUncertain?:()=>Promise<void>};
  ttsOutput?:Pick<RealtimeTtsOutputQueue,"suspend"|"close"|"drainInFlight">;
}

export class RealtimeSessionFinalizer {
  private flushPromise?: Promise<RealtimeFlushSummary>;
  private recoveryDrainPromise?: Promise<void>;
  private recoveryDrainConfirmed = false;
  private finalizePromise?: Promise<void>;
  private sessionDiagnostics?: RealtimeSessionDiagnosticsDto;
  private providerFlushFailed = false;

  constructor(private readonly options: RealtimeSessionFinalizerOptions) {}

  flush() {
    this.flushPromise ??= this.flushOnce();
    return this.flushPromise;
  }

  /** Drains accepted PCM before a same-process recovery checkpoint without
   * ending the supplier session. Finalization retains its separate cached
   * close path, so a successful recovery drain cannot consume session.finish. */
  drainForRecovery() {
    if (this.flushPromise) return this.flushPromise.then(() => undefined);
    this.recoveryDrainPromise ??= this.drainForRecoveryOnce();
    return this.recoveryDrainPromise;
  }

  finalize(reason: SessionEndReason, remainingSeconds?: number) {
    this.finalizePromise ??= this.finalizeOnce(reason, remainingSeconds);
    return this.finalizePromise;
  }

  private async flushOnce() {
    if(this.options.confirmed)this.options.ttsOutput?.suspend();
    this.options.flushTracker.beginFinalization();
    this.options.audioBatcher.stopAccepting();
    const audioFlushed = await this.runStep(
      "audio",
      () => this.options.audioBatcher.flush(),
    );
    if(this.options.confirmed&&!this.recoveryDrainConfirmed)await this.options.confirmed.beforeFlush();
    const providerFlushed = await this.runStep("provider", () => flushProviderSession(
      this.options.provider,
      this.options.sessionId,
      this.options.send,
      {failOnError:!!this.options.confirmed,finishSession:true},
    ));
    if(!providerFlushed)this.providerFlushFailed=true;
    this.sessionDiagnostics ??= await this.collectDiagnostics();
    await this.options.drainSessionSync();
    if(this.options.confirmed&&(!audioFlushed||!providerFlushed))throw Error("public_final_flush_unconfirmed");
    return this.options.flushTracker.summarize({
      audioFlushed,
      providerFlushed,
    });
  }

  private async drainForRecoveryOnce() {
    this.options.audioBatcher.stopAccepting();
    const audioFlushed = await this.runStep(
      "audio",
      () => this.options.audioBatcher.flush(),
    );
    if (this.options.confirmed) await this.options.confirmed.beforeFlush();
    const providerFlushed = await this.runStep("provider", () => flushProviderSession(
      this.options.provider,
      this.options.sessionId,
      this.options.send,
      { failOnError: !!this.options.confirmed, finishSession: false },
    ));
    await this.options.drainSessionSync();
    if (this.options.confirmed && (!audioFlushed || !providerFlushed)) {
      throw Error("public_recovery_drain_unconfirmed");
    }
    this.recoveryDrainConfirmed = true;
  }

  private async finalizeOnce(
    reason: SessionEndReason,
    remainingSeconds?: number,
  ) {
    const ending = transitionStatus(this.options.sessionId, "ending");
    if (!ending?.transition.accepted) return;
    if(this.options.confirmed)logPublicSessionEnd({sessionId:this.options.sessionId,reason,stage:"requested"});
    if(this.options.confirmed)this.options.ttsOutput?.close();
    let flush:RealtimeFlushSummary;
    try {flush = await this.flush();}catch(error){
      if(this.options.confirmed)logPublicSessionEnd({sessionId:this.options.sessionId,reason,stage:"flush_unconfirmed"});
      // A failed durable drain cannot confirm session.ended, but must not keep
      // a model session alive after the user's physical stop.
      await this.runStep("provider",()=>this.options.provider.closeSession(this.options.sessionId));
      // Keep a durable stopped watermark for a Provider-originated failure,
      // while deliberately withholding session.ended and settlement until the
      // API's existing reconciliation evidence is present.
      if(this.providerFlushFailed&&this.options.confirmed?.stopUncertain){
        try{await this.options.confirmed.stopUncertain();}
        catch(stopError){this.options.onError("provider",stopError);}
      }
      throw error;
    }

    const session = getSession(this.options.sessionId);
    if (!session) return;
    const billableSeconds = sessionBillableSeconds(session);
    await this.runStep("provider", () =>
      this.options.provider.closeSession(this.options.sessionId));
    transitionStatus(session.id, "ended");
    this.options.send({
      type: "session.ended",
      sessionId: session.id,
      reason,
      billableSeconds,
      flush,
      diagnostics: this.sessionDiagnostics ?? await this.collectDiagnostics(),
      ...(typeof remainingSeconds === "number" ? { remainingSeconds } : {}),
    });
    try {await this.options.drainSessionSync();}catch(error){
      if(this.options.confirmed)logPublicSessionEnd({sessionId:session.id,reason,stage:"sync_unconfirmed"});
      throw error;
    }
    if(this.options.confirmed)logPublicSessionEnd({sessionId:session.id,reason,stage:"sync_drained"});
    // Cancel immediately, but persist the authoritative stop BEFORE waiting for
    // cancelled TTS metadata. Late known-attempt writes must not extend metering.
    if(this.options.confirmed)await this.options.ttsOutput?.drainInFlight();
  }

  private async runStep(
    stage: "audio" | "provider",
    operation: () => Promise<void>,
  ) {
    try {
      await operation();
      return true;
    } catch (error) {
      this.options.onError(stage, error);
      return false;
    }
  }

  private async collectDiagnostics(): Promise<RealtimeSessionDiagnosticsDto> {
    let providerDiagnostics: Partial<RealtimeSessionDiagnosticsDto> = {};
    try {
      providerDiagnostics = await this.options.provider.diagnostics?.(this.options.sessionId) ?? {};
    } catch (error) {
      // Diagnostics are optional observations, not durable transcript/stop
      // acknowledgements. Their failure must not skip drainSessionSync or the
      // original unique-settlement path after a successful flush.
      this.options.onError("provider", error);
    }
    return {
      version: 1,
      audio: this.options.audioBatcher.diagnostics?.() ?? {
        receivedFrameCount: 0,
        processedBatchCount: 0,
        droppedFrameCount: 0,
      },
      ...providerDiagnostics,
    };
  }
}
