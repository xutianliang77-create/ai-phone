import type {
  RealtimeSpeakerAssemblyRepairDiagnosticsDto,
  SpeakerTokenSplitRejectionReason,
} from "@translation/contracts";
import type {
  AsrProvider,
  AsrSpeakerBoundaryEvidence,
  TranscriptResult,
} from "../../asr/asr-provider.js";
import { realtimeLogger } from "../../metrics/realtime-metrics.js";
import { protectedTermsFor } from
  "../../speaker/speaker-high-context-delivery.js";
import { reconcileRealtimeSpeakerTokenBoundaries } from
  "../../speaker/speaker-realtime-token-reconciliation.js";
import type { RealtimeProviderSession } from "../realtime-provider.js";

interface PendingTranscript {
  transcript: TranscriptResult;
  storedAtMs: number;
}

interface SessionState {
  enabled: boolean;
  pending: Map<string, PendingTranscript>;
  lastEvidenceFingerprint?: string;
  diagnostics: RepairDiagnostics;
}

interface RepairDiagnostics {
  cachedParentCount: number;
  boundaryEvidenceArrivalCount: number;
  repairAttemptCount: number;
  repairAcceptedCount: number;
  delayedRepairAcceptedCount: number;
  repairRejectedCount: number;
  revisionEmittedCount: number;
  expiredParentCount: number;
  rejectionReasonCounts: Partial<Record<
    SpeakerTokenSplitRejectionReason,
    number
  >>;
  totalWaitMs: number;
  maxWaitMs: number;
}

const MAX_PENDING_TRANSCRIPTS = 12;
const MAX_PENDING_MS = 15_000;

export class PostAssemblySpeakerRepairCoordinator {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly asr: AsrProvider) {}

  createSession(session: RealtimeProviderSession) {
    const enabled = session.asrEndpointMode === "listening" &&
      Boolean(
        this.asr.speakerBoundaryEvidence &&
        this.asr.resolveSpeakerBoundaries,
      );
    this.sessions.set(session.sessionId, {
      enabled,
      pending: new Map(),
      diagnostics: emptyDiagnostics(),
    });
  }

  repairReady(
    session: RealtimeProviderSession,
    transcripts: TranscriptResult[],
  ) {
    const repaired = this.repairPending(session);
    for (const transcript of transcripts) {
      const result = this.tryRepair(session, transcript);
      repaired.push(...result.transcripts);
      if (result.resolvedBoundaryMs.length === 0) {
        this.remember(session.sessionId, transcript);
      }
    }
    return repaired;
  }

  repairPending(session: RealtimeProviderSession) {
    const state = this.sessions.get(session.sessionId);
    if (!state?.enabled) return [];
    const nowMs = Date.now();
    for (const [segmentId, pending] of state.pending) {
      if (nowMs - pending.storedAtMs <= MAX_PENDING_MS) continue;
      state.pending.delete(segmentId);
      state.diagnostics.expiredParentCount += 1;
    }
    const evidence = this.asr.speakerBoundaryEvidence?.(session.sessionId);
    if (!evidence || evidence.boundaries.length === 0) return [];
    const fingerprint = evidence.boundaries
      .map((boundary) => boundary.boundaryMs)
      .sort((left, right) => left - right)
      .join(",");
    if (state.lastEvidenceFingerprint === fingerprint) return [];
    state.lastEvidenceFingerprint = fingerprint;
    state.diagnostics.boundaryEvidenceArrivalCount += 1;
    realtimeLogger.info({
      sessionId: session.sessionId,
      boundaryCount: evidence.boundaries.length,
      pendingParentCount: state.pending.size,
    }, "Delayed speaker boundary evidence arrived");
    const repaired: TranscriptResult[] = [];
    for (const [segmentId, pending] of state.pending) {
      const result = this.tryRepairWithEvidence(
        session,
        pending.transcript,
        evidence,
      );
      if (result.resolvedBoundaryMs.length === 0) continue;
      state.pending.delete(segmentId);
      const revision = (pending.transcript.revision ?? 0) + 1;
      const revisions = result.transcripts.map((transcript) => ({
        ...transcript,
        revision,
      }));
      repaired.push(...revisions);
      const waitMs = Math.max(0, nowMs - pending.storedAtMs);
      state.diagnostics.delayedRepairAcceptedCount += 1;
      state.diagnostics.revisionEmittedCount += revisions.length;
      state.diagnostics.totalWaitMs += waitMs;
      state.diagnostics.maxWaitMs = Math.max(
        state.diagnostics.maxWaitMs,
        waitMs,
      );
      realtimeLogger.info({
        sessionId: session.sessionId,
        segmentId,
        waitMs,
        revision,
        revisionEmittedCount: revisions.length,
        resolvedBoundaryMs: result.resolvedBoundaryMs,
      }, "Delayed speaker boundary revision emitted");
    }
    return repaired;
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  diagnostics(
    sessionId: string,
  ): RealtimeSpeakerAssemblyRepairDiagnosticsDto | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    const diagnostics = state.diagnostics;
    return {
      enabled: state.enabled,
      cachedParentCount: diagnostics.cachedParentCount,
      boundaryEvidenceArrivalCount:
        diagnostics.boundaryEvidenceArrivalCount,
      repairAttemptCount: diagnostics.repairAttemptCount,
      repairAcceptedCount: diagnostics.repairAcceptedCount,
      delayedRepairAcceptedCount: diagnostics.delayedRepairAcceptedCount,
      repairRejectedCount: diagnostics.repairRejectedCount,
      revisionEmittedCount: diagnostics.revisionEmittedCount,
      expiredParentCount: diagnostics.expiredParentCount,
      pendingParentCount: state.pending.size,
      rejectionReasonCounts: { ...diagnostics.rejectionReasonCounts },
      averageWaitMs: diagnostics.delayedRepairAcceptedCount === 0
        ? 0
        : Math.round(
          diagnostics.totalWaitMs /
            diagnostics.delayedRepairAcceptedCount,
        ),
      maxWaitMs: diagnostics.maxWaitMs,
    };
  }

  private tryRepair(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
  ) {
    const evidence = this.asr.speakerBoundaryEvidence?.(session.sessionId);
    if (!evidence || evidence.boundaries.length === 0) {
      return unchanged(transcript);
    }
    return this.tryRepairWithEvidence(session, transcript, evidence);
  }

  private tryRepairWithEvidence(
    session: RealtimeProviderSession,
    transcript: TranscriptResult,
    evidence: AsrSpeakerBoundaryEvidence,
  ) {
    const diagnostics = this.sessions.get(session.sessionId)?.diagnostics;
    if (diagnostics) diagnostics.repairAttemptCount += 1;
    const confirmedSpeakerIds = new Set(evidence.confirmedSpeakerIds);
    const result = reconcileRealtimeSpeakerTokenBoundaries({
      transcripts: [transcript],
      boundaries: evidence.boundaries,
      spans: evidence.spans,
      isConfirmedSpeakerId: (speakerId) =>
        confirmedSpeakerIds.has(speakerId),
      protectedTerms: protectedTermsFor(session),
    });
    if (result.resolvedBoundaryMs.length > 0) {
      if (diagnostics) diagnostics.repairAcceptedCount += 1;
      this.asr.resolveSpeakerBoundaries?.(
        session.sessionId,
        result.resolvedBoundaryMs,
      );
    } else if (result.skippedParents.length > 0 && diagnostics) {
      diagnostics.repairRejectedCount += 1;
      for (const skipped of result.skippedParents) {
        diagnostics.rejectionReasonCounts[skipped.reason] =
          (diagnostics.rejectionReasonCounts[skipped.reason] ?? 0) + 1;
      }
    }
    logSkippedParents(session.sessionId, result.skippedParents);
    return result;
  }

  private remember(sessionId: string, transcript: TranscriptResult) {
    const state = this.sessions.get(sessionId);
    if (
      !state?.enabled || transcript.isFinal === false ||
      !transcript.timing || (transcript.tokenTimings?.length ?? 0) < 2
    ) return;
    state.pending.set(transcript.segmentId, {
      transcript,
      storedAtMs: Date.now(),
    });
    state.diagnostics.cachedParentCount += 1;
    realtimeLogger.info({
      sessionId,
      segmentId: transcript.segmentId,
      revision: transcript.revision,
      timing: transcript.timing,
      pendingParentCount: state.pending.size,
    }, "Post-assembly speaker parent cached");
    while (state.pending.size > MAX_PENDING_TRANSCRIPTS) {
      state.pending.delete(state.pending.keys().next().value!);
    }
  }
}

function emptyDiagnostics(): RepairDiagnostics {
  return {
    cachedParentCount: 0,
    boundaryEvidenceArrivalCount: 0,
    repairAttemptCount: 0,
    repairAcceptedCount: 0,
    delayedRepairAcceptedCount: 0,
    repairRejectedCount: 0,
    revisionEmittedCount: 0,
    expiredParentCount: 0,
    rejectionReasonCounts: {},
    totalWaitMs: 0,
    maxWaitMs: 0,
  };
}

function unchanged(transcript: TranscriptResult) {
  return {
    transcripts: [transcript],
    splitSegmentIds: [],
    resolvedBoundaryMs: [],
    skippedParents: [],
  };
}

function logSkippedParents(
  sessionId: string,
  skipped: ReturnType<
    typeof reconcileRealtimeSpeakerTokenBoundaries
  >["skippedParents"],
) {
  if (skipped.length === 0) return;
  realtimeLogger.info({
    sessionId,
    skippedParentCount: skipped.length,
    skippedParents: skipped.map((item) => ({
      segmentId: item.segmentId,
      boundaryMs: item.boundaryMs,
      reason: item.reason,
    })),
  }, "Post-assembly token-timing speaker split kept fail-closed");
}
