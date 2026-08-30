import type {
  AudioFrame,
  ServerRealtimeEvent,
} from "@translation/contracts";
import type { TranscriptResult } from "../asr/asr-provider.js";
import type {
  RealtimeProvider,
  RealtimeProviderSession,
  TextSegmentInput,
} from "../providers/realtime-provider.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { SpeakerRevisionAudioBuffer } from "./speaker-revision-audio-buffer.js";
import type { SpeakerRevisionProvider } from "./speaker-revision-provider.js";
import {
  reconcileSpeakerRevision,
} from "./speaker-revision-reconciler.js";
import {
  type StoredTranscriptFinal,
} from "./speaker-high-context-token-split.js";
import {
  planSpeakerFirstSegmentation,
} from "./speaker-first-segmentation.js";
import {
  assertCompleteSplitDelivery,
  protectedTermsFor,
} from "./speaker-high-context-delivery.js";
import { recordSkippedParentDiagnostics } from
  "./speaker-revision-skip-diagnostics.js";

export type SpeakerRevisionMode = "shadow" | "apply";

interface RevisionSessionState {
  generation: number;
  enabled: boolean;
  audio: SpeakerRevisionAudioBuffer;
  segments: Map<string, RevisionTranscriptRecord>;
  protectedTerms: string[];
  diagnostics: {
    requestCount: number;
    completedCount: number;
    acceptedCount: number;
    emittedUpdateCount: number;
    errorCount: number;
    staleResultCount: number;
    splitParentCount: number;
    splitChildCount: number;
    splitRejectedCount: number;
    splitSkippedParentCount: number;
    splitSkippedReasonCounts: Record<string, number>;
    cardinalityMismatchCount: number;
    lastLatencyMs?: number;
  };
}

type RevisionTranscriptRecord = StoredTranscriptFinal & {
  speakerRevision?: number;
};

export class SpeakerRevisionRealtimeProvider implements RealtimeProvider {
  readonly name: string;
  private readonly sessions = new Map<string, RevisionSessionState>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly base: RealtimeProvider,
    private readonly revision: SpeakerRevisionProvider,
    private readonly options: {
      mode: SpeakerRevisionMode;
      maxWindowMs: number;
      tokenSplitEnabled?: boolean;
    },
  ) {
    this.name = base.name;
  }

  async createSession(session: RealtimeProviderSession) {
    const generation = (this.generations.get(session.sessionId) ?? 0) + 1;
    this.generations.set(session.sessionId, generation);
    this.sessions.set(session.sessionId, {
      generation,
      enabled: session.asrEndpointMode === "listening",
      audio: new SpeakerRevisionAudioBuffer(this.options.maxWindowMs),
      segments: new Map(),
      protectedTerms: protectedTermsFor(session),
      diagnostics: {
        requestCount: 0,
        completedCount: 0,
        acceptedCount: 0,
        emittedUpdateCount: 0,
        errorCount: 0,
        staleResultCount: 0,
        splitParentCount: 0,
        splitChildCount: 0,
        splitRejectedCount: 0,
        splitSkippedParentCount: 0,
        splitSkippedReasonCounts: {},
        cardinalityMismatchCount: 0,
      },
    });
    await this.base.createSession(session);
  }

  async *sendAudio(frame: AudioFrame): AsyncGenerator<ServerRealtimeEvent> {
    this.sessions.get(frame.sessionId)?.audio.push(frame);
    for await (const event of this.base.sendAudio(frame)) {
      this.record(event);
      yield event;
    }
  }

  async *sendText(
    segment: TextSegmentInput,
  ): AsyncGenerator<ServerRealtimeEvent> {
    if (!this.base.sendText) return;
    for await (const event of this.base.sendText(segment)) {
      this.record(event);
      yield event;
    }
  }

  async *flushSession(sessionId: string): AsyncGenerator<ServerRealtimeEvent> {
    if (this.base.flushSession) {
      for await (const event of this.base.flushSession(sessionId)) {
        this.record(event);
        yield event;
      }
    }
    const state = this.sessions.get(sessionId);
    if (!state?.enabled) return;
    const request = state.audio.snapshot(sessionId, state.generation);
    if (!request) return;
    state.diagnostics.requestCount += 1;
    try {
      const revision = await this.revision.revise(request);
      if (!this.isCurrent(sessionId, state, revision.generation)) {
        state.diagnostics.staleResultCount += 1;
        return;
      }
      state.diagnostics.completedCount += 1;
      if (typeof revision.latencyMs === "number") {
        state.diagnostics.lastLatencyMs = revision.latencyMs;
      }
      if (
        this.options.tokenSplitEnabled &&
        revision.provider === "sortformer_high_context"
      ) {
        const plan = planSpeakerFirstSegmentation(
          revision,
          [...state.segments.values()],
          state.protectedTerms,
        );
        realtimeLogger.info({
          sessionId,
          generation: state.generation,
          provider: revision.provider,
          model: revision.model,
          mode: this.options.mode,
          accepted: plan.accepted,
          reason: plan.accepted ? undefined : plan.reason,
          speakerCount: revision.speakerCount,
          parentCount: plan.parentSegmentIds.length,
          childCount: plan.transcripts.length,
          speakerUpdateCount: plan.speakerUpdates.length,
          skippedParentCount: plan.skippedParents.length,
          skippedReasons: plan.skippedParents.map((item) => item.reason),
          latencyMs: revision.latencyMs,
        }, "Speaker-first high-context segmentation completed");
        if (!plan.accepted) {
          state.diagnostics.splitRejectedCount += 1;
          if (
            plan.reason === "canonical_cardinality_mismatch" ||
            plan.reason === "speaker_count_growth" ||
            plan.reason === "single_speaker_collapse"
          ) {
            state.diagnostics.cardinalityMismatchCount += 1;
          }
          return;
        }
        if (this.options.mode === "shadow") {
          state.diagnostics.acceptedCount += 1;
          state.diagnostics.splitParentCount += plan.parentSegmentIds.length;
          state.diagnostics.splitChildCount += plan.transcripts.length;
          recordSkippedParentDiagnostics(state.diagnostics, plan.skippedParents);
          return;
        }
        const staged = await this.stageTokenSplitTranslations(
          sessionId,
          plan.transcripts,
        );
        state.diagnostics.acceptedCount += 1;
        state.diagnostics.splitParentCount += plan.parentSegmentIds.length;
        state.diagnostics.splitChildCount += plan.transcripts.length;
        recordSkippedParentDiagnostics(state.diagnostics, plan.skippedParents);
        state.diagnostics.emittedUpdateCount += plan.speakerUpdates.length;
        for (const event of [...plan.speakerUpdates, ...staged]) {
          this.record(event);
          yield event;
        }
        return;
      }
      const reconciled = reconcileSpeakerRevision(
        revision,
        [...state.segments.values()],
      );
      realtimeLogger.info({
        sessionId,
        generation: state.generation,
        provider: revision.provider,
        model: revision.model,
        mode: this.options.mode,
        accepted: reconciled.accepted,
        reason: reconciled.reason,
        speakerCount: revision.speakerCount,
        spanCount: revision.spans.length,
        updateCount: reconciled.updates.length,
        latencyMs: revision.latencyMs,
      }, "Post-segment speaker revision completed");
      if (reconciled.accepted) state.diagnostics.acceptedCount += 1;
      if (this.options.mode === "apply" && reconciled.accepted) {
        state.diagnostics.emittedUpdateCount += reconciled.updates.length;
        for (const event of reconciled.updates) {
          this.record(event);
          yield event;
        }
      }
    } catch (error) {
      state.diagnostics.errorCount += 1;
      realtimeLogger.warn({
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error
          ? error.message
          : "Unknown speaker revision failure",
        sessionId,
        generation: state.generation,
        mode: this.options.mode,
      }, "Post-segment speaker revision failed open");
    } finally {
      if (this.sessions.get(sessionId) === state) state.audio.clear();
    }
  }

  async closeSession(sessionId: string) {
    this.sessions.get(sessionId)?.audio.clear();
    this.sessions.delete(sessionId);
    await this.base.closeSession(sessionId);
  }

  async diagnostics(sessionId: string) {
    const underlying = await this.base.diagnostics?.(sessionId) ?? {};
    const state = this.sessions.get(sessionId);
    return {
      ...underlying,
      ...(state
        ? {
            speakerRevision: {
              configuredProvider: "http" as const,
              mode: this.options.mode,
              ...state.diagnostics,
            },
          }
        : {}),
    };
  }

  async healthCheck() {
    const baseReady = await this.base.healthCheck();
    if (!baseReady || this.options.mode === "shadow") return baseReady;
    return await this.revision.healthCheck();
  }

  private record(event: ServerRealtimeEvent) {
    if (!("sessionId" in event) || typeof event.sessionId !== "string") return;
    const state = this.sessions.get(event.sessionId);
    if (!state) return;
    if (event.type === "transcript.final") {
      const existing = state.segments.get(event.segmentId);
      state.audio.checkpoint(event.timing?.endMs);
      state.segments.set(event.segmentId, {
        ...event,
        type: "transcript.final",
        turnId: event.turnId ?? existing?.turnId,
        speakerRevision: existing?.speakerRevision,
        speaker: event.speaker ?? existing?.speaker,
        timing: event.timing ?? existing?.timing,
      });
      this.trimSegments(state);
      return;
    }
    if (event.type === "speaker.updated") {
      const existing = state.segments.get(event.segmentId);
      if (!existing) return;
      state.segments.set(event.segmentId, {
        ...existing,
        turnId: event.turnId ?? existing.turnId,
        speakerRevision: event.speakerRevision ?? existing.speakerRevision,
        speaker: event.speaker,
        timing: event.timing ?? existing.timing,
      });
    }
  }

  private trimSegments(state: RevisionSessionState) {
    while (state.segments.size > 128) {
      state.segments.delete(state.segments.keys().next().value!);
    }
  }

  private isCurrent(
    sessionId: string,
    state: RevisionSessionState,
    generation: number,
  ) {
    return this.sessions.get(sessionId) === state &&
      state.generation === generation;
  }

  private async stageTokenSplitTranslations(
    sessionId: string,
    transcripts: TranscriptResult[],
  ) {
    if (transcripts.length === 0) return [];
    if (!this.base.sendText) {
      throw new Error("Realtime provider cannot translate split transcripts");
    }
    const staged: ServerRealtimeEvent[] = [];
    for (const transcript of transcripts) {
      for await (const event of this.base.sendText({
        sessionId,
        segmentId: transcript.segmentId,
        turnId: transcript.turnId,
        revision: transcript.revision,
        text: transcript.text,
        language: transcript.language,
        dominantLanguage: transcript.dominantLanguage,
        detectedLanguages: transcript.detectedLanguages,
        mixedLanguage: transcript.mixedLanguage,
        isFinal: true,
        confidence: transcript.confidence,
        speaker: transcript.speaker,
        timing: transcript.timing,
        tokenTimings: transcript.tokenTimings,
        endpointReason: transcript.endpointReason,
        vadContext: transcript.vadContext,
        finalizeImmediately: true,
      })) staged.push(event);
    }
    assertCompleteSplitDelivery(transcripts, staged);
    return staged;
  }
}
