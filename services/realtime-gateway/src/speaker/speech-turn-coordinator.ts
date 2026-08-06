import type { SpeakerSpan } from "./speaker-attribution-provider.js";

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
}

interface TailEvidence {
  speakerId: string;
  startMs: number;
  endMs: number;
  evidenceMs: number;
  confidence: number;
  dominanceRatio: number;
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
    const evidence = dominantTailEvidence(spans, this.tailToleranceMs);
    if (!evidence || !this.isReliable(evidence, state)) {
      state.candidate = undefined;
      return null;
    }
    if (state.currentSpeakerId === evidence.speakerId) {
      state.candidate = undefined;
      return null;
    }
    if (!state.currentSpeakerId) {
      state.currentSpeakerId = evidence.speakerId;
      state.confirmedSpeakerIds.add(evidence.speakerId);
      state.candidate = undefined;
      return null;
    }

    const candidate = updateCandidate(
      state.candidate,
      evidence,
      this.candidateStartToleranceMs,
    );
    state.candidate = candidate;
    if (candidate.observations < this.stableWindows) return null;

    const previousSpeakerId = state.currentSpeakerId;
    state.currentSpeakerId = evidence.speakerId;
    state.confirmedSpeakerIds.add(evidence.speakerId);
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

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private isReliable(evidence: TailEvidence, state: SessionState) {
    const minimumConfidence = state.confirmedSpeakerIds.has(evidence.speakerId)
      ? this.minimumConfidence
      : this.minimumNovelSpeakerConfidence;
    return evidence.evidenceMs >= this.minimumEvidenceMs &&
      evidence.dominanceRatio >= this.minimumDominanceRatio &&
      evidence.confidence >= minimumConfidence;
  }

  private stateFor(sessionId: string) {
    const state = this.sessions.get(sessionId) ?? {
      confirmedSpeakerIds: new Set<string>(),
    };
    this.sessions.set(sessionId, state);
    return state;
  }
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

function dominantTailEvidence(
  spans: SpeakerSpan[],
  tailToleranceMs: number,
): TailEvidence | null {
  const usable = spans.filter((span) =>
    span.overlap !== true &&
    span.endMs > span.startMs &&
    typeof span.confidence === "number"
  );
  const latestEndMs = usable.reduce(
    (latest, span) => Math.max(latest, span.endMs),
    0,
  );
  if (latestEndMs === 0) return null;

  const candidates = [...new Set(
    usable
      .filter((span) => latestEndMs - span.endMs <= tailToleranceMs)
      .map((span) => span.speakerId),
  )].map((speakerId) => speakerTailEvidence(
    speakerId,
    latestEndMs,
    usable,
    tailToleranceMs,
  )).filter((item): item is TailEvidence => item !== null);

  return candidates.sort((left, right) =>
    right.evidenceMs - left.evidenceMs ||
    right.confidence - left.confidence
  )[0] ?? null;
}

function speakerTailEvidence(
  speakerId: string,
  latestEndMs: number,
  spans: SpeakerSpan[],
  tailToleranceMs: number,
): TailEvidence | null {
  const intervals = mergeIntervals(
    spans
      .filter((span) => span.speakerId === speakerId)
      .map((span) => ({ startMs: span.startMs, endMs: span.endMs })),
    tailToleranceMs,
  );
  const tail = [...intervals].reverse().find(
    (interval) => latestEndMs - interval.endMs <= tailToleranceMs,
  );
  if (!tail) return null;

  const evidenceMs = overlapForSpeaker(spans, speakerId, tail.startMs, tail.endMs);
  const totalEvidenceMs = [...new Set(spans.map((span) => span.speakerId))]
    .reduce(
      (total, id) => total + overlapForSpeaker(spans, id, tail.startMs, tail.endMs),
      0,
    );
  const confidence = weightedConfidence(
    spans.filter((span) => span.speakerId === speakerId),
    tail.startMs,
    tail.endMs,
  );
  if (confidence === null) return null;
  return {
    speakerId,
    startMs: tail.startMs,
    endMs: tail.endMs,
    evidenceMs,
    confidence,
    dominanceRatio: evidenceMs / Math.max(1, totalEvidenceMs),
  };
}

function overlapForSpeaker(
  spans: SpeakerSpan[],
  speakerId: string,
  startMs: number,
  endMs: number,
) {
  return mergeIntervals(
    spans
      .filter((span) => span.speakerId === speakerId)
      .map((span) => ({
        startMs: Math.max(startMs, span.startMs),
        endMs: Math.min(endMs, span.endMs),
      }))
      .filter((interval) => interval.endMs > interval.startMs),
    0,
  ).reduce((total, interval) => total + interval.endMs - interval.startMs, 0);
}

function weightedConfidence(
  spans: SpeakerSpan[],
  startMs: number,
  endMs: number,
) {
  const evidence = spans.flatMap((span) => {
    if (typeof span.confidence !== "number") return [];
    const weight = Math.max(
      0,
      Math.min(endMs, span.endMs) - Math.max(startMs, span.startMs),
    );
    return weight > 0 ? [{ value: span.confidence, weight }] : [];
  });
  const weight = evidence.reduce((total, item) => total + item.weight, 0);
  if (weight === 0) return null;
  return evidence.reduce(
    (total, item) => total + item.value * item.weight,
    0,
  ) / weight;
}

function mergeIntervals(
  intervals: Array<{ startMs: number; endMs: number }>,
  gapToleranceMs: number,
) {
  const sorted = [...intervals].sort((left, right) =>
    left.startMs - right.startMs || left.endMs - right.endMs
  );
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.startMs > previous.endMs + gapToleranceMs) {
      merged.push({ ...interval });
    } else {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    }
  }
  return merged;
}
