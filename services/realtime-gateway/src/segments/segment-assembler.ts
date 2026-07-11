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
  consumedIds: Set<string>;
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

    if (this.mustSplit(pending, transcript, nowMs)) {
      const ready = this.releasePending(state, nowMs);
      const current = this.acceptNew(state, transcript, nowMs);
      return { ready: [...ready, ...current.ready], ...(current.partial ? { partial: current.partial } : {}) };
    }

    const existingIndex = pending.parts.findIndex((part) => part.segmentId === transcript.segmentId);
    if (existingIndex >= 0) {
      if (sameText(pending.parts[existingIndex].text, transcript.text)) return { ready: [] };
      pending.parts[existingIndex] = transcript;
    } else if (isPendingDuplicate(pending, transcript)) {
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
    return pending.parts.at(-1)?.language !== transcript.language ||
      speakerKey(pending.parts.at(-1)) !== speakerKey(transcript) ||
      nowMs - pending.createdAtMs >= this.maxBufferMs;
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
    for (const segmentId of consumedIds) state.consumedIds.add(segmentId);
    if (state.emitted.length > this.maxRememberedFinals) state.emitted.shift();
  }

  private stateFor(sessionId: string) {
    const state = this.sessions.get(sessionId) ?? {
      emitted: [],
      consumedIds: new Set<string>(),
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
    return state.consumedIds.has(transcript.segmentId) ||
      state.emitted.some((emitted) =>
        fingerprint.length > 0 &&
        emitted.fingerprint === fingerprint &&
        nowMs - emitted.emittedAtMs <= this.duplicateTextWindowMs);
  }
}

function speakerKey(transcript: TranscriptResult | undefined) {
  return transcript?.speaker?.speakerId ?? "";
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
