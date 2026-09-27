import type { SpeechTranscript } from "./speech-transcript.js";
import { mergeTranscriptParts } from "./segment-text.js";
import {isSemanticContinuationCandidate,startsSemanticContinuation} from "./semantic-continuation-boundary.js";

interface ProvisionalContinuation {
  transcript: SpeechTranscript;
  emittedAtMs: number;
  highestPreviewRevision?: number;
  semantic?: boolean;
  partCount?: number;
  semanticParts?: SpeechTranscript[];
}

export interface ContinuationRevisionDecision {
  handled: boolean;
  transcript?: SpeechTranscript;
  transcripts?: SpeechTranscript[];
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
    semanticContinuations?: boolean;
    semanticSourceLanguage?: string;
    maxSemanticParts?: number;
    maxSemanticCharacters?: number;
  }) {}

  /** Called only for an actually emitted ordinary segment, after the inherited
   * pending assembler. Never cache the un-emitted second half of a held prefix. */
  rememberSemantic(sessionId:string,transcript:SpeechTranscript,nowMs:number,partCount:number) {
    if(!this.options.semanticContinuations)return;
    if(!isSemanticContinuationCandidate(transcript,this.options.semanticSourceLanguage)||partCount>=(this.options.maxSemanticParts??3)||
      Array.from(transcript.text).length>=(this.options.maxSemanticCharacters??180))return;
    this.provisional.set(sessionId,{transcript:structuredClone(transcript),emittedAtMs:nowMs,semantic:true,partCount,
      semanticParts:[structuredClone(transcript)]});
  }

  push(
    sessionId: string,
    transcript: SpeechTranscript,
    nowMs: number,
  ): ContinuationRevisionDecision {
    if (!this.options.enabled&&!this.options.semanticContinuations) return { handled: false };
    const pending = this.activeProvisional(sessionId, nowMs);
    if (!pending) return this.acceptNew(sessionId, transcript, nowMs);
    if(pending.semanticParts){
      const index=pending.semanticParts.findIndex(part=>part.segmentId===transcript.segmentId);
      if(index>=0)return this.replaceSemanticPart(sessionId,pending,transcript,index);
    }
    if (pending.transcript.segmentId === transcript.segmentId) {
      return this.replaceSameSegment(sessionId, pending, transcript);
    }
    const semantic=pending.semantic===true;
    const semanticAllowed=semantic&&isSemanticContinuationCandidate(transcript,this.options.semanticSourceLanguage)&&startsSemanticContinuation(transcript,pending.transcript)&&
      (pending.partCount??1)<(this.options.maxSemanticParts??3)&&
      Array.from(pending.transcript.text+transcript.text).length<=(this.options.maxSemanticCharacters??180);
    if ((semantic&&!semanticAllowed)||!canReviseContinuation(
      pending.transcript,
      transcript,
      this.options,
      semantic,
    )) {
      this.provisional.delete(sessionId);
      return this.acceptNew(sessionId, transcript, nowMs);
    }
    const revised = revisedContinuation(
      pending.transcript,
      transcript,
      pending.highestPreviewRevision,
      semantic,
    );
    if(semantic){
      const partCount=(pending.partCount??1)+1;
      this.provisional.set(sessionId,{...pending,transcript:revised,partCount,
        semanticParts:[...pending.semanticParts!,structuredClone(transcript)]});
    } else if (transcript.endpointReason === "max_duration") {
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
    if (!pending || pending.semantic || pending.transcript.segmentId === transcript.segmentId) {
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

  private replaceSemanticPart(sessionId:string,pending:ProvisionalContinuation,incoming:SpeechTranscript,index:number):ContinuationRevisionDecision {
    const parts=pending.semanticParts!;
    if((incoming.revision??0)<=(parts[index].revision??0))return {handled:true};
    if(parts.length===1){this.provisional.delete(sessionId);return {handled:false};}
    const updated=parts.map((part,i)=>i===index?structuredClone(incoming):part);
    const revision=Math.max((pending.transcript.revision??0)+1,...updated.map(part=>part.revision??0));
    const safe=updated.every(part=>isSemanticContinuationCandidate(part,this.options.semanticSourceLanguage))&&updated.slice(1).every((part,i)=>
      startsSemanticContinuation(part,updated[i])&&canReviseContinuation(updated[i],part,this.options,true))&&
      Array.from(updated.map(part=>part.text).join("")).length<=(this.options.maxSemanticCharacters??180);
    if(!safe){
      // The original text/revision path can undo a grouping. Re-emit every
      // constituent at a newer revision; never drop an absorbed tail or retain
      // a now-invalid cross-speaker label. Metadata-only events cannot do this.
      this.provisional.delete(sessionId);
      return {handled:true,transcripts:updated.map(part=>({...part,revision}))};
    }
    const transcript={...mergeTranscriptParts(updated,{joinSemanticContinuation:true}),revision};
    this.provisional.set(sessionId,{...pending,transcript,semanticParts:updated});
    return {handled:true,transcript,consumedSegmentIds:updated.map(part=>part.segmentId),
      supersededSegmentIds:updated.slice(1).map(part=>part.segmentId)};
  }

  private acceptNew(
    sessionId: string,
    transcript: SpeechTranscript,
    nowMs: number,
  ): ContinuationRevisionDecision {
    if (!this.options.enabled || transcript.endpointReason !== "max_duration") {
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
    if (transcript.endpointReason === "max_duration") {
      this.provisional.set(sessionId, {
        transcript,
        emittedAtMs: pending.emittedAtMs,
        highestPreviewRevision: pending.highestPreviewRevision,
      });
    } else {
      this.provisional.delete(sessionId);
    }
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
  semantic = false,
) {
  const merged = mergeTranscriptParts([previous, current], {
    allowSingleCharacterCjkOverlap: !semantic,
    joinSemanticContinuation: semantic,
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
  semantic = false,
) {
  if ((!semantic&&previous.endpointReason !== "max_duration") ||
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
