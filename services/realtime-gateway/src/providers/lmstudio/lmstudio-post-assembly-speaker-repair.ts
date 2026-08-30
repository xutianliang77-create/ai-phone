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
}

const MAX_PENDING_TRANSCRIPTS = 12;
const MAX_PENDING_MS = 15_000;

export class PostAssemblySpeakerRepairCoordinator {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly asr: AsrProvider) {}

  createSession(session: RealtimeProviderSession) {
    this.sessions.set(session.sessionId, {
      enabled: session.asrEndpointMode === "listening" &&
        Boolean(
          this.asr.speakerBoundaryEvidence &&
          this.asr.resolveSpeakerBoundaries,
        ),
      pending: new Map(),
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
    const evidence = this.asr.speakerBoundaryEvidence?.(session.sessionId);
    if (!evidence || evidence.boundaries.length === 0) return [];
    const fingerprint = evidence.boundaries
      .map((boundary) => boundary.boundaryMs)
      .sort((left, right) => left - right)
      .join(",");
    if (state.lastEvidenceFingerprint === fingerprint) return [];
    state.lastEvidenceFingerprint = fingerprint;
    const nowMs = Date.now();
    const repaired: TranscriptResult[] = [];
    for (const [segmentId, pending] of state.pending) {
      if (nowMs - pending.storedAtMs > MAX_PENDING_MS) {
        state.pending.delete(segmentId);
        continue;
      }
      const result = this.tryRepairWithEvidence(
        session,
        pending.transcript,
        evidence,
      );
      if (result.resolvedBoundaryMs.length === 0) continue;
      state.pending.delete(segmentId);
      const revision = (pending.transcript.revision ?? 0) + 1;
      repaired.push(...result.transcripts.map((transcript) => ({
        ...transcript,
        revision,
      })));
    }
    return repaired;
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
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
      this.asr.resolveSpeakerBoundaries?.(
        session.sessionId,
        result.resolvedBoundaryMs,
      );
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
    while (state.pending.size > MAX_PENDING_TRANSCRIPTS) {
      state.pending.delete(state.pending.keys().next().value!);
    }
  }
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
