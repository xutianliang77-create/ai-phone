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

interface RealtimeSessionFinalizerOptions {
  sessionId: string;
  provider: RealtimeProvider;
  audioBatcher: Pick<AudioFrameBatcher, "stopAccepting" | "flush"> &
    Partial<Pick<AudioFrameBatcher, "diagnostics">>;
  send: (event: ServerRealtimeEvent) => void;
  drainSessionSync: () => Promise<void>;
  flushTracker: RealtimeFlushTracker;
  onError: (stage: "audio" | "provider", error: unknown) => void;
}

export class RealtimeSessionFinalizer {
  private flushPromise?: Promise<RealtimeFlushSummary>;
  private finalizePromise?: Promise<void>;
  private sessionDiagnostics?: RealtimeSessionDiagnosticsDto;

  constructor(private readonly options: RealtimeSessionFinalizerOptions) {}

  flush() {
    this.flushPromise ??= this.flushOnce();
    return this.flushPromise;
  }

  finalize(reason: SessionEndReason, remainingSeconds?: number) {
    this.finalizePromise ??= this.finalizeOnce(reason, remainingSeconds);
    return this.finalizePromise;
  }

  private async flushOnce() {
    this.options.flushTracker.beginFinalization();
    this.options.audioBatcher.stopAccepting();
    const audioFlushed = await this.runStep(
      "audio",
      () => this.options.audioBatcher.flush(),
    );
    const providerFlushed = await this.runStep("provider", () => flushProviderSession(
      this.options.provider,
      this.options.sessionId,
      this.options.send,
    ));
    this.sessionDiagnostics ??= await this.collectDiagnostics();
    await this.options.drainSessionSync();
    return this.options.flushTracker.summarize({
      audioFlushed,
      providerFlushed,
    });
  }

  private async finalizeOnce(
    reason: SessionEndReason,
    remainingSeconds?: number,
  ) {
    const ending = transitionStatus(this.options.sessionId, "ending");
    if (!ending?.transition.accepted) return;
    const flush = await this.flush();

    const session = getSession(this.options.sessionId);
    if (!session) return;
    const billableSeconds = sessionBillableSeconds(session);
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
    await this.options.drainSessionSync();
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
    return {
      version: 1,
      audio: this.options.audioBatcher.diagnostics?.() ?? {
        receivedFrameCount: 0,
        processedBatchCount: 0,
        droppedFrameCount: 0,
      },
      ...(await this.options.provider.diagnostics?.(this.options.sessionId) ?? {}),
    };
  }
}
