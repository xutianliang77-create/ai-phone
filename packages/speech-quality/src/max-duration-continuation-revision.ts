import type { SpeechTranscript } from "./speech-transcript.js";
import { mergeTranscriptParts } from "./segment-text.js";

interface ProvisionalContinuation {
  transcript: SpeechTranscript;
  emittedAtMs: number;
  highestPreviewRevision?: number;
}

export interface ContinuationRevisionDecision {
  handled: boolean;
  transcript?: SpeechTranscript;
  consumedSegmentIds?: string[];
  supersededSegmentIds?: string[];
}

export class MaxDurationContinuationRevisionCoordinator {
  private readonly provisional = new Map<string, ProvisionalContinuation>();

  constructor(private readonly options: {
    enabled: boolean;
    maxWindowMs: number;
    maxTimingGapMs?: number;
    maxTimingOverlapMs?: number;
  }) {}

  push(
    sessionId: string,
    transcript: SpeechTranscript,
    nowMs: number,
  ): ContinuationRevisionDecision {
    if (!this.options.enabled) return { handled: false };
    const pending = this.activeProvisional(sessionId, nowMs);
    if (!pending) return this.acceptNew(sessionId, transcript, nowMs);
    if (pending.transcript.segmentId === transcript.segmentId) {
      return this.replaceSameSegment(sessionId, pending, transcript);
    }
    if (!canReviseContinuation(
      pending.transcript,
      transcript,
      this.options,
    )) {
      this.provisional.delete(sessionId);
      return this.acceptNew(sessionId, transcript, nowMs);
    }
    const revised = revisedContinuation(
      pending.transcript,
      transcript,
      pending.highestPreviewRevision,
    );
    if (transcript.endpointReason === "max_duration") {
      this.provisional.set(sessionId, { transcript: revised, emittedAtMs: nowMs });
    } else {
      this.provisional.delete(sessionId);
    }
    return {
      handled: true,
      transcript: revised,
      consumedSegmentIds: [pending.transcript.segmentId, transcript.segmentId],
      supersededSegmentIds: [transcript.segmentId],
    };
  }

  preview(
    sessionId: string,
    transcript: SpeechTranscript,
    nowMs: number,
  ) {
    if (!this.options.enabled) return undefined;
    const pending = this.activeProvisional(sessionId, nowMs);
    if (!pending || pending.transcript.segmentId === transcript.segmentId) {
      return undefined;
    }
    if (!canReviseContinuation(pending.transcript, transcript, this.options)) {
      return undefined;
    }
    const revised = revisedContinuation(pending.transcript, transcript);
    pending.highestPreviewRevision = Math.max(
      pending.highestPreviewRevision ?? 0,
      revised.revision,
    );
    return revised;
  }

  expire(sessionId: string, nowMs: number) {
    this.activeProvisional(sessionId, nowMs);
  }

  clear(sessionId: string) {
    this.provisional.delete(sessionId);
  }

  private acceptNew(
    sessionId: string,
    transcript: SpeechTranscript,
    nowMs: number,
  ): ContinuationRevisionDecision {
    if (transcript.endpointReason !== "max_duration") {
      return { handled: false };
    }
    this.provisional.set(sessionId, { transcript, emittedAtMs: nowMs });
    return {
      handled: true,
      transcript,
      consumedSegmentIds: [transcript.segmentId],
    };
  }

  private replaceSameSegment(
    sessionId: string,
    pending: ProvisionalContinuation,
    transcript: SpeechTranscript,
  ): ContinuationRevisionDecision {
    const previousRevision = pending.transcript.revision ?? 0;
    const incomingRevision = transcript.revision ?? 0;
    if (incomingRevision <= previousRevision) return { handled: true };
    this.provisional.set(sessionId, {
      transcript,
      emittedAtMs: pending.emittedAtMs,
      highestPreviewRevision: pending.highestPreviewRevision,
    });
    return {
      handled: true,
      transcript,
      consumedSegmentIds: [transcript.segmentId],
    };
  }

  private activeProvisional(sessionId: string, nowMs: number) {
    const pending = this.provisional.get(sessionId);
    if (!pending) return undefined;
    if (nowMs - pending.emittedAtMs <= this.options.maxWindowMs) return pending;
    this.provisional.delete(sessionId);
    return undefined;
  }
}

function revisedContinuation(
  previous: SpeechTranscript,
  current: SpeechTranscript,
  minimumRevision = 0,
) {
  const merged = mergeTranscriptParts([previous, current], {
    allowSingleCharacterCjkOverlap: true,
  });
  return {
    ...merged,
    revision: Math.max(
      Math.max(previous.revision ?? 0, current.revision ?? 0) + 1,
      minimumRevision,
    ),
  };
}

function canReviseContinuation(
  previous: SpeechTranscript,
  current: SpeechTranscript,
  options: { maxTimingGapMs?: number; maxTimingOverlapMs?: number },
) {
  if (previous.endpointReason !== "max_duration" ||
      previous.language !== current.language ||
      !previous.turnId || previous.turnId !== current.turnId ||
      !sameKnownSpeaker(previous, current) ||
      !safeTiming(previous, current, options)) return false;
  return true;
}

function sameKnownSpeaker(
  previous: SpeechTranscript,
  current: SpeechTranscript,
) {
  const first = previous.speaker;
  const second = current.speaker;
  return Boolean(
    first && second &&
    first.speakerId !== "unknown" && second.speakerId !== "unknown" &&
    first.role !== "unknown" && second.role !== "unknown" &&
    first.source !== "unknown" && second.source !== "unknown" &&
    first.speakerId === second.speakerId,
  );
}

function safeTiming(
  previous: SpeechTranscript,
  current: SpeechTranscript,
  options: { maxTimingGapMs?: number; maxTimingOverlapMs?: number },
) {
  const first = previous.timing;
  const second = current.timing;
  if (!first || !second || first.overlap === true || second.overlap === true) {
    return false;
  }
  const speakerId = previous.speaker?.speakerId;
  if (!safeActiveSpeakers(first.activeSpeakerIds, speakerId) ||
      !safeActiveSpeakers(second.activeSpeakerIds, speakerId)) return false;
  const gapMs = second.startMs - first.endMs;
  return gapMs >= -(options.maxTimingOverlapMs ?? 500) &&
    gapMs <= (options.maxTimingGapMs ?? 750);
}

function safeActiveSpeakers(
  activeSpeakerIds: string[] | undefined,
  expectedSpeakerId: string | undefined,
) {
  const unique = Array.from(new Set(activeSpeakerIds ?? []));
  return unique.length <= 1 &&
    (unique.length === 0 || unique[0] === expectedSpeakerId);
}
