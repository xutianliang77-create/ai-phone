import type {
  SpeakerTurnCoordinatorDecisionReason,
} from "@translation/contracts";
import type { SpeakerSpan } from "./speaker-attribution-provider.js";
import {
  dominantTailEvidence,
  type TailEvidence,
} from "./speech-turn-evidence.js";

export interface SpeechTurnBoundary {
  previousSpeakerId: string;
  nextSpeakerId: string;
  boundaryMs: number;
  confirmedAtMs: number;
  confidence: number;
  dominanceRatio: number;
}

export interface SpeechTurnCoordinatorOptions {
  minimumEvidenceMs?: number;
  minimumDominanceRatio?: number;
  minimumConfidence?: number;
  minimumNovelSpeakerConfidence?: number;
  stableWindows?: number;
  tailToleranceMs?: number;
  candidateStartToleranceMs?: number;
}

interface CandidateState {
  speakerId: string;
  startMs: number;
  lastEndMs: number;
  observations: number;
}

interface SessionState {
  currentSpeakerId?: string;
  candidate?: CandidateState;
  confirmedSpeakerIds: Set<string>;
  coordinatorDecisionCounts: Partial<Record<
    SpeakerTurnCoordinatorDecisionReason,
    number
  >>;
}

const DEFAULT_MINIMUM_EVIDENCE_MS = 240;
const DEFAULT_MINIMUM_DOMINANCE_RATIO = 0.65;
const DEFAULT_MINIMUM_CONFIDENCE = 0.6;
const DEFAULT_MINIMUM_NOVEL_SPEAKER_CONFIDENCE = 0.7;
const DEFAULT_STABLE_WINDOWS = 2;
const DEFAULT_TAIL_TOLERANCE_MS = 80;
const DEFAULT_CANDIDATE_START_TOLERANCE_MS = 160;

export class SpeechTurnCoordinator {
  private readonly minimumEvidenceMs: number;
  private readonly minimumDominanceRatio: number;
  private readonly minimumConfidence: number;
  private readonly minimumNovelSpeakerConfidence: number;
  private readonly stableWindows: number;
  private readonly tailToleranceMs: number;
  private readonly candidateStartToleranceMs: number;
  private readonly sessions = new Map<string, SessionState>();

  constructor(options: SpeechTurnCoordinatorOptions = {}) {
    this.minimumEvidenceMs = options.minimumEvidenceMs ??
      DEFAULT_MINIMUM_EVIDENCE_MS;
    this.minimumDominanceRatio = options.minimumDominanceRatio ??
      DEFAULT_MINIMUM_DOMINANCE_RATIO;
    this.minimumConfidence = options.minimumConfidence ??
      DEFAULT_MINIMUM_CONFIDENCE;
    this.minimumNovelSpeakerConfidence =
      options.minimumNovelSpeakerConfidence ??
        DEFAULT_MINIMUM_NOVEL_SPEAKER_CONFIDENCE;
    this.stableWindows = options.stableWindows ?? DEFAULT_STABLE_WINDOWS;
    this.tailToleranceMs = options.tailToleranceMs ?? DEFAULT_TAIL_TOLERANCE_MS;
    this.candidateStartToleranceMs = options.candidateStartToleranceMs ??
      DEFAULT_CANDIDATE_START_TOLERANCE_MS;
  }

  observe(sessionId: string, spans: SpeakerSpan[]): SpeechTurnBoundary | null {
    const state = this.stateFor(sessionId);
    const result = dominantTailEvidence(spans, this.tailToleranceMs);
    if (!result.evidence) {
      this.recordDecision(state, result.rejectionReason);
      state.candidate = undefined;
      return null;
    }
    const evidence = result.evidence;
    const rejectionReason = this.reliabilityRejection(evidence, state);
    if (rejectionReason) {
      this.recordDecision(state, rejectionReason);
      state.candidate = undefined;
      return null;
    }
    if (state.currentSpeakerId === evidence.speakerId) {
      this.recordDecision(state, "current_speaker");
      state.candidate = undefined;
      return null;
    }
    if (!state.currentSpeakerId) {
      state.currentSpeakerId = evidence.speakerId;
      state.confirmedSpeakerIds.add(evidence.speakerId);
      this.recordDecision(state, "initial_speaker_confirmed");
      state.candidate = undefined;
      return null;
    }

    const resetReason = candidateResetReason(
      state.candidate,
      evidence,
      this.candidateStartToleranceMs,
    );
    const candidate = updateCandidate(
      state.candidate,
      evidence,
      this.candidateStartToleranceMs,
    );
    state.candidate = candidate;
    if (candidate.observations < this.stableWindows) {
      this.recordDecision(state, resetReason ?? "stable_window_pending");
      return null;
    }

    const previousSpeakerId = state.currentSpeakerId;
    state.currentSpeakerId = evidence.speakerId;
    state.confirmedSpeakerIds.add(evidence.speakerId);
    this.recordDecision(state, "boundary_confirmed");
    state.candidate = undefined;
    if (!previousSpeakerId) return null;
    return {
      previousSpeakerId,
      nextSpeakerId: evidence.speakerId,
      boundaryMs: candidate.startMs,
      confirmedAtMs: evidence.endMs,
      confidence: evidence.confidence,
      dominanceRatio: evidence.dominanceRatio,
    };
  }

  currentSpeaker(sessionId: string) {
    return this.sessions.get(sessionId)?.currentSpeakerId;
  }

  isConfirmedSpeaker(sessionId: string, speakerId: string) {
    return this.sessions.get(sessionId)?.confirmedSpeakerIds.has(speakerId) ??
      false;
  }

  recordNoSpanObservation(sessionId: string) {
    this.recordDecision(this.stateFor(sessionId), "no_span");
  }

  diagnostics(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    return {
      coordinatorDecisionCounts: { ...state.coordinatorDecisionCounts },
      confirmedSpeakerCount: state.confirmedSpeakerIds.size,
    };
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private reliabilityRejection(
    evidence: TailEvidence,
    state: SessionState,
  ): SpeakerTurnCoordinatorDecisionReason | undefined {
    if (evidence.evidenceMs < this.minimumEvidenceMs) {
      return "evidence_too_short";
    }
    if (evidence.dominanceRatio < this.minimumDominanceRatio) {
      return "dominance_too_low";
    }
    const knownSpeaker = state.confirmedSpeakerIds.has(evidence.speakerId);
    const minimumConfidence = state.confirmedSpeakerIds.has(evidence.speakerId)
      ? this.minimumConfidence
      : this.minimumNovelSpeakerConfidence;
    if (evidence.confidence >= minimumConfidence) return undefined;
    return knownSpeaker
      ? "known_confidence_too_low"
      : "novel_confidence_too_low";
  }

  private recordDecision(
    state: SessionState,
    reason: SpeakerTurnCoordinatorDecisionReason,
  ) {
    state.coordinatorDecisionCounts[reason] =
      (state.coordinatorDecisionCounts[reason] ?? 0) + 1;
  }

  private stateFor(sessionId: string) {
    const state = this.sessions.get(sessionId) ?? {
      confirmedSpeakerIds: new Set<string>(),
      coordinatorDecisionCounts: {},
    };
    this.sessions.set(sessionId, state);
    return state;
  }
}

function candidateResetReason(
  current: CandidateState | undefined,
  evidence: TailEvidence,
  startToleranceMs: number,
): SpeakerTurnCoordinatorDecisionReason | undefined {
  if (!current) return undefined;
  if (current.speakerId !== evidence.speakerId) return "candidate_reset_label";
  if (Math.abs(current.startMs - evidence.startMs) > startToleranceMs) {
    return "candidate_reset_start_drift";
  }
  return undefined;
}

function updateCandidate(
  current: CandidateState | undefined,
  evidence: TailEvidence,
  startToleranceMs: number,
): CandidateState {
  if (
    !current ||
    current.speakerId !== evidence.speakerId ||
    Math.abs(current.startMs - evidence.startMs) > startToleranceMs
  ) {
    return {
      speakerId: evidence.speakerId,
      startMs: evidence.startMs,
      lastEndMs: evidence.endMs,
      observations: 1,
    };
  }
  if (evidence.endMs <= current.lastEndMs) return current;
  return {
    ...current,
    startMs: evidence.startMs,
    lastEndMs: evidence.endMs,
    observations: current.observations + 1,
  };
}
