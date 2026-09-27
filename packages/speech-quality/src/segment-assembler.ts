import type { SpeechTranscript } from "./speech-transcript.js";
import {
  isStructuredFieldPrefix,
  shouldHoldForNextSegment,
} from "./segment-boundary.js";
import { canonicalSegmentText, mergeTranscriptParts } from "./segment-text.js";
import { MaxDurationContinuationRevisionCoordinator } from "./max-duration-continuation-revision.js";
import {transcriptDuplicateScope,mayBeSameRecognizedSpeech,type TranscriptDuplicateScope} from "./segment-duplicate-scope.js";

interface PendingSegment {
  parts: SpeechTranscript[];
  createdAtMs: number;
}

interface EmittedSegment {
  fingerprint: string;
  emittedAtMs: number;
  scope: TranscriptDuplicateScope;
}

interface SessionAssemblyState {
  sessionId: string;
  pending?: PendingSegment;
  emitted: EmittedSegment[];
  consumedRevisions: Map<string, number>;
}

export interface SegmentAssemblerOptions {
  maxBufferedSegments?: number;
  maxBufferedCharacters?: number;
  maxBufferMs?: number;
  maxContinuationBufferMs?: number;
  maxStructuredBufferMs?: number;
  maxRememberedFinals?: number;
  duplicateTextWindowMs?: number;
  emitMaxDurationRevisions?: boolean;
  emitSemanticContinuationRevisions?: boolean;
  semanticSourceLanguage?: string;
  lateSpeakerRevisions?:boolean;
}

export interface SegmentPushResult {
  ready: SpeechTranscript[];
  partial?: SpeechTranscript;
  supersededSegmentIds?: string[];
}

const DEFAULT_MAX_BUFFERED_SEGMENTS = 3;
const DEFAULT_MAX_BUFFERED_CHARACTERS = 180;
const DEFAULT_MAX_BUFFER_MS = 1800;
const DEFAULT_MAX_CONTINUATION_BUFFER_MS = 5000;
const DEFAULT_MAX_STRUCTURED_BUFFER_MS = 7000;
const DEFAULT_MAX_REMEMBERED_FINALS = 64;
const DEFAULT_DUPLICATE_TEXT_WINDOW_MS = 1200;

export class SegmentAssembler {
  private readonly maxBufferedSegments: number;
  private readonly maxBufferedCharacters: number;
  private readonly maxBufferMs: number;
  private readonly maxContinuationBufferMs: number;
  private readonly maxStructuredBufferMs: number;
  private readonly maxRememberedFinals: number;
  private readonly duplicateTextWindowMs: number;
  private readonly continuationRevisions: MaxDurationContinuationRevisionCoordinator;
  private readonly sessions = new Map<string, SessionAssemblyState>();

  constructor(options: SegmentAssemblerOptions = {}) {
    this.maxBufferedSegments = options.maxBufferedSegments ?? DEFAULT_MAX_BUFFERED_SEGMENTS;
    this.maxBufferedCharacters = options.maxBufferedCharacters ?? DEFAULT_MAX_BUFFERED_CHARACTERS;
    this.maxBufferMs = options.maxBufferMs ?? DEFAULT_MAX_BUFFER_MS;
    this.maxContinuationBufferMs = options.maxContinuationBufferMs ??
      DEFAULT_MAX_CONTINUATION_BUFFER_MS;
    this.maxStructuredBufferMs = options.maxStructuredBufferMs ??
      DEFAULT_MAX_STRUCTURED_BUFFER_MS;
    this.maxRememberedFinals = options.maxRememberedFinals ?? DEFAULT_MAX_REMEMBERED_FINALS;
    this.duplicateTextWindowMs = options.duplicateTextWindowMs ?? DEFAULT_DUPLICATE_TEXT_WINDOW_MS;
    this.continuationRevisions = new MaxDurationContinuationRevisionCoordinator({
      enabled: options.emitMaxDurationRevisions === true,
      maxWindowMs: this.maxContinuationBufferMs,
      semanticContinuations: options.emitSemanticContinuationRevisions === true,
      semanticSourceLanguage: options.semanticSourceLanguage,
      maxSemanticParts: this.maxBufferedSegments,
      maxSemanticCharacters: this.maxBufferedCharacters,
      lateSpeakerRevisions:options.lateSpeakerRevisions,
    });
  }

  push(sessionId: string, transcript: SpeechTranscript, nowMs = Date.now()): SegmentPushResult {
    const state = this.stateFor(sessionId);
    const continuation = this.continuationRevisions.push(sessionId, transcript, nowMs);
    if (continuation.handled) {
      const ready=continuation.transcripts??(continuation.transcript?[continuation.transcript]:[]);
      for(const item of ready)this.remember(state,item,continuation.consumedSegmentIds??[item.segmentId],nowMs,false);
      return {
        ready,
        ...(continuation.supersededSegmentIds
          ? { supersededSegmentIds: continuation.supersededSegmentIds }
          : {}),
      };
    }
    if (this.isAlreadyEmitted(state, transcript, nowMs)) return { ready: [],
      ...(!state.consumedRevisions.has(transcript.segmentId) ? { supersededSegmentIds: [transcript.segmentId] } : {}) };
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
      const replaced = [...(ready.supersededSegmentIds ?? []), ...(current.supersededSegmentIds ?? [])];
      return { ready: [...ready.ready, ...current.ready], ...(current.partial ? { partial: current.partial } : {}),
        ...(replaced.length ? { supersededSegmentIds: replaced } : {}) };
    }

    if (isPendingDuplicate(pending, transcript)) {
      return { ready: [], supersededSegmentIds: [transcript.segmentId] };
    } else {
      pending.parts.push(transcript);
    }

    const merged = mergeTranscriptParts(pending.parts);
    if (this.shouldRelease(pending, merged, nowMs)) return this.releasePending(state, nowMs);
    return { ready: [], partial: merged };
  }

  drainExpired(sessionId: string, nowMs = Date.now()) {
    return this.drainExpiredWithReplacements(sessionId, nowMs).ready;
  }

  drainExpiredWithReplacements(sessionId: string, nowMs = Date.now()): SegmentPushResult {
    this.continuationRevisions.expire(sessionId, nowMs);
    const state = this.sessions.get(sessionId);
    if (!state?.pending ||
        nowMs - state.pending.createdAtMs < this.bufferMs(state.pending)) return { ready: [] };
    return this.releasePending(state, nowMs);
  }

  flush(sessionId: string, nowMs = Date.now()) {
    return this.flushWithReplacements(sessionId, nowMs).ready;
  }

  flushWithReplacements(sessionId: string, nowMs = Date.now(), options: {preserveContinuations?:boolean} = {}): SegmentPushResult {
    const state = this.sessions.get(sessionId);
    const result=state?.pending ? this.releasePending(state, nowMs) : { ready: [] };
    // PCM barriers retain only the remaining window; pause/end still clear it.
    if(options.preserveContinuations)this.continuationRevisions.expire(sessionId,nowMs);else this.continuationRevisions.clear(sessionId);
    return result;
  }
  clear(sessionId: string) {
    this.sessions.delete(sessionId);
    this.continuationRevisions.clear(sessionId);
  }

  refreshSpeakers(sessionId:string,project:(parts:SpeechTranscript[])=>SpeechTranscript[],nowMs=Date.now()):SegmentPushResult {
    const result=this.continuationRevisions.refreshSpeakers(sessionId,project,nowMs);
    if(!result.transcript)return {ready:[]};
    this.remember(this.stateFor(sessionId),result.transcript,result.consumedSegmentIds??[],nowMs,false);
    return {ready:[result.transcript],supersededSegmentIds:result.supersededSegmentIds};
  }

  previewContinuation(
    sessionId: string,
    transcript: SpeechTranscript,
    nowMs = Date.now(),
  ) {
    return this.continuationRevisions.preview(sessionId, transcript, nowMs);
  }

  private acceptNew(
    state: SessionAssemblyState,
    transcript: SpeechTranscript,
    nowMs: number,
  ): SegmentPushResult {
    if (this.isAlreadyEmitted(state, transcript, nowMs)) return { ready: [] };
    if (
      !isMaxDuration(transcript) &&
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

  private mustSplit(pending: PendingSegment, transcript: SpeechTranscript, nowMs: number) {
    const previous = pending.parts.at(-1);
    return isProtectedSpeakerBoundary(previous) ||
      isProtectedSpeakerBoundary(transcript) ||
      previous?.automaticLanguageStatus === "detected" && transcript.automaticLanguageStatus === "detected" && previous.language !== transcript.language ||
      speakerKey(previous) !== speakerKey(transcript) ||
      turnKey(previous) !== turnKey(transcript) ||
      nowMs - pending.createdAtMs >= this.bufferMs(pending);
  }

  private replacePendingRevision(
    state: SessionAssemblyState,
    pending: PendingSegment,
    transcript: SpeechTranscript,
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
      return this.releasePending(state, nowMs);
    }
    return { ready: [], partial: merged };
  }

  private shouldRelease(pending: PendingSegment, merged: SpeechTranscript, nowMs: number) {
    return !isMaxDuration(pending.parts.at(-1)) &&
        !shouldHoldForNextSegment(merged.text, merged.language) ||
      pending.parts.length >= this.maxBufferedSegments ||
      Array.from(merged.text).length >= this.maxBufferedCharacters ||
      nowMs - pending.createdAtMs >= this.bufferMs(pending);
  }

  private bufferMs(pending: PendingSegment) {
    if (pending.parts.some((part) =>
      isStructuredFieldPrefix(part.text, part.language)
    )) return this.maxStructuredBufferMs;
    return pending.parts.some(isMaxDuration)
      ? this.maxContinuationBufferMs
      : this.maxBufferMs;
  }

  private releasePending(state: SessionAssemblyState, nowMs: number): SegmentPushResult {
    const pending = state.pending;
    if (!pending) return { ready: [] };
    state.pending = undefined;
    const transcript = mergeTranscriptParts(pending.parts);
    this.remember(state, transcript, pending.parts.map((part) => part.segmentId), nowMs);
    const supersededSegmentIds = [...new Set(pending.parts.map(part => part.segmentId))]
      .filter(id => id !== transcript.segmentId);
    return { ready: [transcript], ...(supersededSegmentIds.length ? { supersededSegmentIds } : {}) };
  }

  private remember(
    state: SessionAssemblyState,
    transcript: SpeechTranscript,
    consumedIds: string[],
    emittedAtMs: number,
    rememberSemantic = true,
  ) {
    if(rememberSemantic)this.continuationRevisions.rememberSemantic(state.sessionId,transcript,emittedAtMs,consumedIds.length);
    state.emitted.push({
      fingerprint: canonicalSegmentText(transcript.text),
      emittedAtMs,
      scope: transcriptDuplicateScope(transcript),
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
      sessionId,
      emitted: [],
      consumedRevisions: new Map<string, number>(),
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  private isAlreadyEmitted(
    state: SessionAssemblyState,
    transcript: SpeechTranscript,
    nowMs: number,
  ) {
    const fingerprint = canonicalSegmentText(transcript.text);
    const consumedRevision = state.consumedRevisions.get(transcript.segmentId);
    if (consumedRevision !== undefined) {
      return consumedRevision >= (transcript.revision ?? 0);
    }
    const scope=transcriptDuplicateScope(transcript);
    return state.emitted.some((emitted) =>
        fingerprint.length > 0 &&
        emitted.fingerprint === fingerprint &&
        mayBeSameRecognizedSpeech(emitted.scope,scope) &&
        nowMs - emitted.emittedAtMs <= this.duplicateTextWindowMs);
  }
}

function isMaxDuration(transcript: SpeechTranscript | undefined) {
  return transcript?.endpointReason === "max_duration";
}

function speakerKey(transcript: SpeechTranscript | undefined) {
  return transcript?.speaker?.speakerId ?? "";
}

function turnKey(transcript: SpeechTranscript | undefined) {
  return transcript?.turnId ?? "";
}

function isProtectedSpeakerBoundary(transcript: SpeechTranscript | undefined) {
  const speaker = transcript?.speaker;
  return transcript?.timing?.overlap === true ||
    speaker?.speakerId === "unknown" ||
    speaker?.role === "unknown" ||
    speaker?.source === "unknown";
}

function isStalePendingRevision(
  existing: SpeechTranscript,
  incoming: SpeechTranscript,
) {
  if (existing.revision === undefined || incoming.revision === undefined) {
    return false;
  }
  return incoming.revision <= existing.revision;
}

function isPendingDuplicate(pending: PendingSegment, transcript: SpeechTranscript) {
  const fingerprint = canonicalSegmentText(transcript.text);
  return pending.parts.some((part) => canonicalSegmentText(part.text) === fingerprint) ||
    canonicalSegmentText(mergeTranscriptParts(pending.parts).text) === fingerprint;
}

function sameText(first: string, second: string) {
  return canonicalSegmentText(first) === canonicalSegmentText(second);
}

export { shouldHoldForNextSegment } from "./segment-boundary.js";
