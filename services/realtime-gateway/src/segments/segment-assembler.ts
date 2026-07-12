import type { TranscriptResult } from "../asr/asr-provider.js";
import { shouldHoldForNextSegment } from "./segment-boundary.js";
import { canonicalSegmentText, mergeTranscriptParts } from "./segment-text.js";

interface PendingSegment {
  parts: TranscriptResult[];
  createdAtMs: number;
}

interface EmittedSegment {
  fingerprint: string;
  emittedAtMs: number;
}

interface SessionAssemblyState {
  pending?: PendingSegment;
  emitted: EmittedSegment[];
  consumedRevisions: Map<string, number>;
}

export interface SegmentAssemblerOptions {
  maxBufferedSegments?: number;
  maxBufferedCharacters?: number;
  maxBufferMs?: number;
  maxRememberedFinals?: number;
  duplicateTextWindowMs?: number;
}

export interface SegmentPushResult {
  ready: TranscriptResult[];
  partial?: TranscriptResult;
}

const DEFAULT_MAX_BUFFERED_SEGMENTS = 3;
const DEFAULT_MAX_BUFFERED_CHARACTERS = 180;
const DEFAULT_MAX_BUFFER_MS = 1800;
const DEFAULT_MAX_REMEMBERED_FINALS = 64;
const DEFAULT_DUPLICATE_TEXT_WINDOW_MS = 1200;

export class SegmentAssembler {
  private readonly maxBufferedSegments: number;
  private readonly maxBufferedCharacters: number;
  private readonly maxBufferMs: number;
  private readonly maxRememberedFinals: number;
  private readonly duplicateTextWindowMs: number;
  private readonly sessions = new Map<string, SessionAssemblyState>();

  constructor(options: SegmentAssemblerOptions = {}) {
    this.maxBufferedSegments = options.maxBufferedSegments ?? DEFAULT_MAX_BUFFERED_SEGMENTS;
    this.maxBufferedCharacters = options.maxBufferedCharacters ?? DEFAULT_MAX_BUFFERED_CHARACTERS;
    this.maxBufferMs = options.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS;
    this.maxRememberedFinals = options.maxRememberedFinals ?? DEFAULT_MAX_REMEMBERED_FINALS;
    this.duplicateTextWindowMs = options.duplicateTextWindowMs ?? DEFAULT_DUPLICATE_TEXT_WINDOW_MS;
  }

  push(sessionId: string, transcript: TranscriptResult, nowMs = Date.now()): SegmentPushResult {
    const state = this.stateFor(sessionId);
    if (this.isAlreadyEmitted(state, transcript, nowMs)) return { ready: [] };
    const pending = state.pending;
    if (!pending) return this.acceptNew(state, transcript, nowMs);

    const revised = this.replacePendingRevision(
      state,
      pending,
      transcript,
      nowMs,
    );
    if (revised) return revised;

    if (this.mustSplit(pending, transcript, nowMs)) {
      const ready = this.releasePending(state, nowMs);
      const current = this.acceptNew(state, transcript, nowMs);
      return { ready: [...ready, ...current.ready], ...(current.partial ? { partial: current.partial } : {}) };
    }

    if (isPendingDuplicate(pending, transcript)) {
      return { ready: [] };
    } else {
      pending.parts.push(transcript);
    }

    const merged = mergeTranscriptParts(pending.parts);
    if (this.shouldRelease(pending, merged, nowMs)) return { ready: this.releasePending(state, nowMs) };
    return { ready: [], partial: merged };
  }

  drainExpired(sessionId: string, nowMs = Date.now()) {
    const state = this.sessions.get(sessionId);
    if (!state?.pending || nowMs - state.pending.createdAtMs < this.maxBufferMs) return [];
    return this.releasePending(state, nowMs);
  }

  flush(sessionId: string, nowMs = Date.now()) {
    const state = this.sessions.get(sessionId);
    return state?.pending ? this.releasePending(state, nowMs) : [];
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  private acceptNew(
    state: SessionAssemblyState,
    transcript: TranscriptResult,
    nowMs: number,
  ): SegmentPushResult {
    if (this.isAlreadyEmitted(state, transcript, nowMs)) return { ready: [] };
    if (
      !shouldHoldForNextSegment(transcript.text, transcript.language) ||
      this.maxBufferedSegments <= 1 ||
      Array.from(transcript.text).length >= this.maxBufferedCharacters
    ) {
      this.remember(state, transcript, [transcript.segmentId], nowMs);
      return { ready: [transcript] };
    }
    state.pending = { parts: [transcript], createdAtMs: nowMs };
    return { ready: [], partial: transcript };
  }

  private mustSplit(pending: PendingSegment, transcript: TranscriptResult, nowMs: number) {
    const previous = pending.parts.at(-1);
    return isProtectedSpeakerBoundary(previous) ||
      isProtectedSpeakerBoundary(transcript) ||
      speakerKey(previous) !== speakerKey(transcript) ||
      turnKey(previous) !== turnKey(transcript) ||
      nowMs - pending.createdAtMs >= this.maxBufferMs;
  }

  private replacePendingRevision(
    state: SessionAssemblyState,
    pending: PendingSegment,
    transcript: TranscriptResult,
    nowMs: number,
  ): SegmentPushResult | null {
    const index = pending.parts.findIndex((part) =>
      part.segmentId === transcript.segmentId);
    if (index < 0) return null;
    const existing = pending.parts[index];
    if (isStalePendingRevision(existing, transcript) ||
        sameText(existing.text, transcript.text) &&
          (transcript.revision ?? 0) <= (existing.revision ?? 0)) {
      return { ready: [] };
    }
    pending.parts[index] = transcript;
    const merged = mergeTranscriptParts(pending.parts);
    if (this.shouldRelease(pending, merged, nowMs)) {
      return { ready: this.releasePending(state, nowMs) };
    }
    return { ready: [], partial: merged };
  }

  private shouldRelease(pending: PendingSegment, merged: TranscriptResult, nowMs: number) {
    return !shouldHoldForNextSegment(merged.text, merged.language) ||
      pending.parts.length >= this.maxBufferedSegments ||
      Array.from(merged.text).length >= this.maxBufferedCharacters ||
      nowMs - pending.createdAtMs >= this.maxBufferMs;
  }

  private releasePending(state: SessionAssemblyState, nowMs: number) {
    const pending = state.pending;
    if (!pending) return [];
    state.pending = undefined;
    const transcript = mergeTranscriptParts(pending.parts);
    this.remember(state, transcript, pending.parts.map((part) => part.segmentId), nowMs);
    return [transcript];
  }

  private remember(
    state: SessionAssemblyState,
    transcript: TranscriptResult,
    consumedIds: string[],
    emittedAtMs: number,
  ) {
    state.emitted.push({
      fingerprint: canonicalSegmentText(transcript.text),
      emittedAtMs,
    });
    for (const segmentId of consumedIds) {
      state.consumedRevisions.set(
        segmentId,
        Math.max(
          state.consumedRevisions.get(segmentId) ?? -1,
          transcript.revision ?? 0,
        ),
      );
    }
    if (state.emitted.length > this.maxRememberedFinals) state.emitted.shift();
  }

  private stateFor(sessionId: string) {
    const state = this.sessions.get(sessionId) ?? {
      emitted: [],
      consumedRevisions: new Map<string, number>(),
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private isAlreadyEmitted(
    state: SessionAssemblyState,
    transcript: TranscriptResult,
    nowMs: number,
  ) {
    const fingerprint = canonicalSegmentText(transcript.text);
    const consumedRevision = state.consumedRevisions.get(transcript.segmentId);
    if (consumedRevision !== undefined) {
      return consumedRevision >= (transcript.revision ?? 0);
    }
    return state.emitted.some((emitted) =>
        fingerprint.length > 0 &&
        emitted.fingerprint === fingerprint &&
        nowMs - emitted.emittedAtMs <= this.duplicateTextWindowMs);
  }
}

function speakerKey(transcript: TranscriptResult | undefined) {
  return transcript?.speaker?.speakerId ?? "";
}

function turnKey(transcript: TranscriptResult | undefined) {
  return transcript?.turnId ?? "";
}

function isProtectedSpeakerBoundary(transcript: TranscriptResult | undefined) {
  const speaker = transcript?.speaker;
  return transcript?.timing?.overlap === true ||
    speaker?.speakerId === "unknown" ||
    speaker?.role === "unknown" ||
    speaker?.source === "unknown";
}

function isStalePendingRevision(
  existing: TranscriptResult,
  incoming: TranscriptResult,
) {
  if (existing.revision === undefined || incoming.revision === undefined) {
    return false;
  }
  return incoming.revision <= existing.revision;
}

function isPendingDuplicate(pending: PendingSegment, transcript: TranscriptResult) {
  const fingerprint = canonicalSegmentText(transcript.text);
  return pending.parts.some((part) => canonicalSegmentText(part.text) === fingerprint) ||
    canonicalSegmentText(mergeTranscriptParts(pending.parts).text) === fingerprint;
}

function sameText(first: string, second: string) {
  return canonicalSegmentText(first) === canonicalSegmentText(second);
}

export { shouldHoldForNextSegment } from "./segment-boundary.js";
