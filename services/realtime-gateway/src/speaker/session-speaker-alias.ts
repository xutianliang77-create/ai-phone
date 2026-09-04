import type {
  SegmentTimingDto,
  SpeakerUpdatedEvent,
} from "@translation/contracts";

export interface SessionSpeakerAliasOptions {
  enabled: boolean;
  minimumEvidenceMs: number;
  similarityThreshold: number;
}

export interface SessionSpeakerAliasObservation {
  sessionId: string;
  rawSpeakerId: string;
  evidenceMs: number;
  overlap: boolean;
  similarities: Record<string, number>;
  mossSpeakerCount?: number;
}

export interface SessionSpeakerSegment {
  sessionId: string;
  rawSpeakerId: string;
  segmentId: string;
  turnId?: string;
  revision?: number;
  timing?: SegmentTimingDto;
}

export type SessionSpeakerAliasDecision =
  | "disabled"
  | "established"
  | "stable_identity"
  | "stable_alias"
  | "insufficient_evidence"
  | "overlap"
  | "below_threshold"
  | "moss_veto"
  | "merged";

export interface SessionSpeakerAliasResult {
  rawSpeakerId: string;
  canonicalSpeakerId: string;
  confidence?: number;
  decision: SessionSpeakerAliasDecision;
  updates: SpeakerUpdatedEvent[];
}

interface SegmentRecord extends SessionSpeakerSegment {
  canonicalSpeakerId: string;
}

interface SessionState {
  aliases: Map<string, string>;
  segments: Map<string, SegmentRecord>;
}

export class SessionSpeakerAliasResolver {
  private readonly sessions = new Map<string, SessionState>();

  constructor(private readonly options: SessionSpeakerAliasOptions) {}

  resolve(input: SessionSpeakerAliasObservation): SessionSpeakerAliasResult {
    if (!this.options.enabled) {
      return result(input.rawSpeakerId, input.rawSpeakerId, "disabled");
    }

    const state = this.stateFor(input.sessionId);
    const established = !state.aliases.has(input.rawSpeakerId);
    if (established) {
      state.aliases.set(input.rawSpeakerId, input.rawSpeakerId);
    }
    const canonicalSpeakerId = canonical(state, input.rawSpeakerId);
    if (canonicalSpeakerId !== input.rawSpeakerId) {
      return result(
        input.rawSpeakerId,
        canonicalSpeakerId,
        "stable_alias",
      );
    }
    if (input.overlap) {
      return result(input.rawSpeakerId, canonicalSpeakerId, "overlap");
    }
    if (input.evidenceMs < this.options.minimumEvidenceMs) {
      return result(
        input.rawSpeakerId,
        canonicalSpeakerId,
        "insufficient_evidence",
      );
    }

    const candidate = bestCandidate(
      input.similarities,
      canonicalSpeakerId,
      state,
    );
    if (!candidate) {
      return result(
        input.rawSpeakerId,
        canonicalSpeakerId,
        established ? "established" : "stable_identity",
      );
    }
    if (candidate.confidence < this.options.similarityThreshold) {
      return result(
        input.rawSpeakerId,
        canonicalSpeakerId,
        "below_threshold",
        candidate.confidence,
      );
    }
    if (mustVetoSingleSpeakerCollapse(state, input.mossSpeakerCount)) {
      return result(
        input.rawSpeakerId,
        canonicalSpeakerId,
        "moss_veto",
        candidate.confidence,
      );
    }

    const updates = mergeCanonicalSpeaker(
      input.sessionId,
      state,
      canonicalSpeakerId,
      candidate.canonicalSpeakerId,
      candidate.confidence,
    );
    return result(
      input.rawSpeakerId,
      candidate.canonicalSpeakerId,
      "merged",
      candidate.confidence,
      updates,
    );
  }

  recordSegment(input: SessionSpeakerSegment) {
    if (!this.options.enabled) return;
    const state = this.stateFor(input.sessionId);
    if (!state.aliases.has(input.rawSpeakerId)) {
      state.aliases.set(input.rawSpeakerId, input.rawSpeakerId);
    }
    state.segments.set(input.segmentId, {
      ...input,
      canonicalSpeakerId: canonical(state, input.rawSpeakerId),
    });
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private stateFor(sessionId: string) {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: SessionState = {
      aliases: new Map(),
      segments: new Map(),
    };
    this.sessions.set(sessionId, created);
    return created;
  }
}

function bestCandidate(
  similarities: Record<string, number>,
  currentCanonicalSpeakerId: string,
  state: SessionState,
) {
  const candidates = Object.entries(similarities).flatMap(
    ([rawSpeakerId, confidence]) => {
      const target = state.aliases.get(rawSpeakerId);
      if (
        !target ||
        target === currentCanonicalSpeakerId ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        return [];
      }
      return [{
        canonicalSpeakerId: canonical(state, target),
        confidence,
      }];
    },
  );
  return candidates.sort((left, right) =>
    right.confidence - left.confidence
  )[0];
}

function mustVetoSingleSpeakerCollapse(
  state: SessionState,
  mossSpeakerCount: number | undefined,
) {
  return canonicalSpeakerCount(state) === 2 &&
    typeof mossSpeakerCount === "number" &&
    mossSpeakerCount > 1;
}

function canonicalSpeakerCount(state: SessionState) {
  return new Set(
    [...state.aliases.keys()].map((rawSpeakerId) =>
      canonical(state, rawSpeakerId)
    ),
  ).size;
}

function mergeCanonicalSpeaker(
  sessionId: string,
  state: SessionState,
  fromSpeakerId: string,
  toSpeakerId: string,
  confidence: number,
) {
  const rawSpeakerIds = [...state.aliases.entries()]
    .filter(([, canonicalSpeakerId]) => canonicalSpeakerId === fromSpeakerId)
    .map(([rawSpeakerId]) => rawSpeakerId);
  for (const rawSpeakerId of rawSpeakerIds) {
    state.aliases.set(rawSpeakerId, toSpeakerId);
  }

  const updates: SpeakerUpdatedEvent[] = [];
  for (const record of state.segments.values()) {
    if (record.canonicalSpeakerId !== fromSpeakerId) continue;
    record.canonicalSpeakerId = toSpeakerId;
    updates.push({
      type: "speaker.updated",
      sessionId,
      segmentId: record.segmentId,
      turnId: record.turnId,
      revision: (record.revision ?? 0) + 1,
      speaker: {
        speakerId: toSpeakerId,
        role: "speaker",
        source: "diarization",
        confidence,
      },
      timing: record.timing,
    });
  }
  return updates;
}

function canonical(state: SessionState, rawSpeakerId: string) {
  let current = rawSpeakerId;
  const visited = new Set<string>();
  while (!visited.has(current)) {
    visited.add(current);
    const next = state.aliases.get(current);
    if (!next || next === current) return current;
    current = next;
  }
  return rawSpeakerId;
}

function result(
  rawSpeakerId: string,
  canonicalSpeakerId: string,
  decision: SessionSpeakerAliasDecision,
  confidence?: number,
  updates: SpeakerUpdatedEvent[] = [],
): SessionSpeakerAliasResult {
  return {
    rawSpeakerId,
    canonicalSpeakerId,
    decision,
    ...(confidence === undefined ? {} : { confidence }),
    updates,
  };
}
