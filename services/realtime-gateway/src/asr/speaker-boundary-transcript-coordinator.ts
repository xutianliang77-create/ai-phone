import type {
  AsrProviderResult,
  AsrSession,
  TranscriptResult,
} from "./asr-provider.js";
import { asrResults } from "./asr-provider.js";
import type { SpeakerTurnReference } from "./speaker-turn-assignment.js";
import { SpeakerTurnAssignment } from "./speaker-turn-assignment.js";
import { SpeakerTurnDiagnostics } from "./speaker-turn-diagnostics.js";
import { SpeakerBoundaryReassignmentCoordinator } from
  "./speaker-boundary-reassignment-coordinator.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { SpeakerSpan } from
  "../speaker/speaker-attribution-provider.js";
import { retainRecentSpeakerBoundaries } from
  "../speaker/speaker-evidence-retention.js";
import { protectedTermsFor } from
  "../speaker/speaker-high-context-delivery.js";
import { reconcileRealtimeSpeakerTokenBoundaries } from
  "../speaker/speaker-realtime-token-reconciliation.js";
import type { ConfirmedSpeakerBoundary } from
  "../speaker/speaker-token-boundary-split.js";
import type { SpeechTurnBoundary } from
  "../speaker/speech-turn-coordinator.js";
import { SpeechTurnCoordinator } from
  "../speaker/speech-turn-coordinator.js";
import {
  crossesBoundary,
  removeOverlappingTranscripts,
  turnForTranscript,
} from "../speaker/speaker-transcript-attribution.js";

interface BoundaryCommit {
  result: AsrProviderResult;
  error: boolean;
}

interface TurnChange {
  previous: SpeakerTurnReference;
  next: SpeakerTurnReference;
}

export interface SpeakerBoundaryFrameResult {
  outgoing: TranscriptResult[];
  currentTurn: SpeakerTurnReference;
  turnChange: TurnChange | null;
}

export class SpeakerBoundaryTranscriptCoordinator {
  private readonly boundariesBySession = new Map<
    string,
    ConfirmedSpeakerBoundary[]
  >();
  private readonly tokenSplitSessions = new Set<string>();
  private readonly protectedTermsBySession = new Map<string, string[]>();

  constructor(
    private readonly turnDiagnostics: SpeakerTurnDiagnostics,
    private readonly turnAssignment: SpeakerTurnAssignment,
    private readonly boundaryReassignment: SpeakerBoundaryReassignmentCoordinator,
    private readonly turnCoordinator: SpeechTurnCoordinator,
  ) {}

  createSession(session: AsrSession) {
    this.boundariesBySession.set(session.sessionId, []);
    if (session.asrEndpointMode !== "listening") return;
    this.tokenSplitSessions.add(session.sessionId);
    this.protectedTermsBySession.set(
      session.sessionId,
      protectedTermsFor(session),
    );
  }

  processFrame(input: {
    sessionId: string;
    boundary: SpeechTurnBoundary | null;
    regularTurns: TranscriptResult[];
    commit: BoundaryCommit;
    spans: SpeakerSpan[];
  }): SpeakerBoundaryFrameResult {
    const turnChange = input.boundary
      ? this.turnAssignment.advance(input.sessionId)
      : null;
    const currentTurn = turnChange?.previous ??
      this.turnAssignment.current(input.sessionId);
    this.recordBoundary(input.sessionId, input.boundary, turnChange);
    const committedTurns = asrResults(input.commit.result).map((transcript) => ({
      ...this.turnAssignment.assign(transcript, currentTurn),
      speaker: transcript.speaker ?? {
        speakerId: input.boundary?.previousSpeakerId ?? "unknown",
        role: "speaker" as const,
        source: "diarization" as const,
      },
    }));
    this.recordBoundaryOutcome(
      input,
      currentTurn,
      turnChange,
      committedTurns,
    );
    const regular = committedTurns.length > 0
      ? removeOverlappingTranscripts(input.regularTurns, committedTurns)
      : input.regularTurns;
    const tokenReconciliation = this.reconcileTokenTiming(
      input.sessionId,
      regular,
      input.spans,
    );
    const splitSegmentIds = new Set(tokenReconciliation.splitSegmentIds);
    const assigned = tokenReconciliation.transcripts.map((transcript) =>
      splitSegmentIds.has(transcript.segmentId)
        ? transcript
        : this.turnAssignment.assign(
          transcript,
          turnForTranscript(
            transcript,
            input.boundary?.boundaryMs,
            currentTurn,
            turnChange?.next,
          ),
        )
    );
    this.applyTokenTimingResolutions(
      input.sessionId,
      tokenReconciliation.resolvedBoundaryMs,
    );
    this.logTokenTimingSkips(
      input.sessionId,
      tokenReconciliation.skippedParents,
    );
    return {
      outgoing: [...assigned, ...committedTurns],
      currentTurn,
      turnChange,
    };
  }

  processFlush(
    sessionId: string,
    transcripts: TranscriptResult[],
    spans: SpeakerSpan[],
  ) {
    const tokenReconciliation = this.reconcileTokenTiming(
      sessionId,
      transcripts,
      spans,
    );
    const currentTurn = this.turnAssignment.current(sessionId);
    const splitSegmentIds = new Set(tokenReconciliation.splitSegmentIds);
    const results = tokenReconciliation.transcripts.map((transcript) =>
      splitSegmentIds.has(transcript.segmentId)
        ? transcript
        : this.turnAssignment.assign(transcript, currentTurn)
    );
    this.applyTokenTimingResolutions(
      sessionId,
      tokenReconciliation.resolvedBoundaryMs,
    );
    this.logTokenTimingSkips(sessionId, tokenReconciliation.skippedParents);
    return results;
  }

  boundaries(sessionId: string) {
    return this.boundariesBySession.get(sessionId) ?? [];
  }

  applyWitnessResolutions(sessionId: string) {
    for (
      const boundaryMs of
      this.boundaryReassignment.drainResolvedBoundaries(sessionId)
    ) {
      this.turnDiagnostics.resolveBoundary(
        sessionId,
        boundaryMs,
        "witness_reassignment",
      );
    }
  }

  clear(sessionId: string) {
    this.boundariesBySession.delete(sessionId);
    this.tokenSplitSessions.delete(sessionId);
    this.protectedTermsBySession.delete(sessionId);
  }

  private recordBoundary(
    sessionId: string,
    boundary: SpeechTurnBoundary | null,
    turnChange: TurnChange | null,
  ) {
    if (!boundary || !turnChange) return;
    this.boundariesBySession.set(
      sessionId,
      retainRecentSpeakerBoundaries(
        this.boundariesBySession.get(sessionId) ?? [],
        {
          ...boundary,
          previousTurnId: turnChange.previous.turnId,
          nextTurnId: turnChange.next.turnId,
        },
      ),
    );
  }

  private recordBoundaryOutcome(
    input: {
      sessionId: string;
      boundary: SpeechTurnBoundary | null;
      regularTurns: TranscriptResult[];
      commit: BoundaryCommit;
    },
    currentTurn: SpeakerTurnReference,
    turnChange: TurnChange | null,
    committedTurns: TranscriptResult[],
  ) {
    const boundary = input.boundary;
    if (!boundary) return;
    const endpointRaceCount = input.regularTurns.filter(
      (item) => crossesBoundary(item, boundary.boundaryMs),
    ).length;
    this.turnDiagnostics.recordBoundary(
      input.sessionId,
      boundary,
      input.commit.error
        ? "error"
        : committedTurns.length > 0 ? "hit" : "miss",
      committedTurns,
      endpointRaceCount,
    );
    if (!input.commit.error && committedTurns.length === 0 && turnChange) {
      this.boundaryReassignment.recordCommitMiss(
        input.sessionId,
        boundary,
        currentTurn,
        turnChange.next,
      );
    }
    realtimeLogger.info({
      sessionId: input.sessionId,
      ...boundary,
      committedTranscriptCount: committedTurns.length,
      endpointRaceCount,
      commitError: input.commit.error,
      ...this.turnDiagnostics.boundaryContext(input.sessionId),
    }, "Confirmed realtime speaker turn boundary");
  }

  private reconcileTokenTiming(
    sessionId: string,
    transcripts: TranscriptResult[],
    spans: SpeakerSpan[],
  ) {
    if (!this.tokenSplitSessions.has(sessionId)) {
      return {
        transcripts,
        splitSegmentIds: [],
        resolvedBoundaryMs: [],
        skippedParents: [],
      };
    }
    const unresolvedBoundaryMs = new Set(
      this.turnDiagnostics.unresolvedBoundaryMs(sessionId),
    );
    return reconcileRealtimeSpeakerTokenBoundaries({
      transcripts,
      boundaries: this.boundaries(sessionId).filter((boundary) =>
        unresolvedBoundaryMs.has(boundary.boundaryMs)
      ),
      spans,
      isConfirmedSpeakerId: (speakerId) =>
        this.turnCoordinator.isConfirmedSpeaker(sessionId, speakerId),
      protectedTerms: this.protectedTermsBySession.get(sessionId) ?? [],
    });
  }

  private applyTokenTimingResolutions(
    sessionId: string,
    boundaryMs: number[],
  ) {
    for (const timestamp of boundaryMs) {
      this.turnDiagnostics.resolveBoundary(
        sessionId,
        timestamp,
        "token_timing_split",
      );
      this.boundaryReassignment.resolveBoundary(sessionId, timestamp);
    }
  }

  private logTokenTimingSkips(
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
    }, "Realtime token-timing speaker split kept fail-closed");
  }
}
