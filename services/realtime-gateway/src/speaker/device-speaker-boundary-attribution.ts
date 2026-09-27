import type {TranscriptResult} from "../asr/asr-provider.js";
import type {SpeakerSpan} from "./speaker-attribution-provider.js";
import type {SpeakerBoundaryGuard} from "./speaker-transcript-attribution.js";
import {evaluateSpeakerSpan,MINIMUM_SPEAKER_EVIDENCE_MS} from "./speaker-segment-aligner.js";
import {DEFAULT_MINIMUM_CONFIDENCE} from "./speech-turn-coordinator.js";

/** Phone-only alignment policy. A sequential switch is not simultaneous speech.
 * An estimated edge may use the inherited 160ms minimum-evidence threshold;
 * an interior/uncertain switch remains unknown, never a guessed speaker. */
export function attributeDeviceSpeakerBoundary<T extends Pick<TranscriptResult,"timing"|"speaker"|"turnId"|"tokenTimings">>(
  transcript:T,spans:SpeakerSpan[],boundaries:SpeakerBoundaryGuard[],
  isConfirmed:(id:string)=>boolean,
):T {
  const timing=transcript.timing!;
  const clipped=spans.map(span=>({...span,startMs:Math.max(timing.startMs,span.startMs),endMs:Math.min(timing.endMs,span.endMs)}))
    .filter(span=>span.endMs>span.startMs);
  const concurrent=simultaneousSpeakers(clipped);
  const overlap=timing.overlap===true||(timing.activeSpeakerIds?.length??0)>1||concurrent.length>0;
  if(!overlap){
    const aligned=alignEstimatedEdge(transcript,clipped,boundaries,isConfirmed);
    if(aligned)return aligned;
  }
  return {...transcript,speaker:{speakerId:"unknown",role:"unknown",source:"unknown"},timing:{...timing,
    overlap,activeSpeakerIds:overlap?[...new Set([...(timing.activeSpeakerIds??[]),...concurrent])]:[]}};
}

function alignEstimatedEdge<T extends Pick<TranscriptResult,"timing"|"speaker"|"turnId"|"tokenTimings">>(transcript:T,spans:SpeakerSpan[],boundaries:SpeakerBoundaryGuard[],isConfirmed:(id:string)=>boolean) {
  const timing=transcript.timing!,minimumEvidence=MINIMUM_SPEAKER_EVIDENCE_MS;
  if(timing.source!=="estimated"||transcript.tokenTimings?.length||boundaries.length!==1)return;
  const boundary=boundaries[0],before=boundary.boundaryMs-timing.startMs,after=timing.endMs-boundary.boundaryMs;
  const nearStart=before>0&&before<minimumEvidence&&after>=minimumEvidence;
  const nearEnd=after>0&&after<minimumEvidence&&before>=minimumEvidence;
  if(!nearStart&&!nearEnd)return;
  const expected=nearStart?boundary.nextSpeakerId:boundary.previousSpeakerId;
  if(expected==="unknown"||!isConfirmed(expected))return;
  const prior=transcript.speaker?.speakerId;
  if(prior&&prior!=="unknown"&&prior!==expected)return;
  const start=nearStart?boundary.boundaryMs:timing.startMs,end=nearStart?timing.endMs:boundary.boundaryMs;
  // Every span is already clipped to the full ASR interval. A rival voice at
  // either edge is still speech evidence, even below 160ms; never discard it
  // merely because one speaker dominates the remainder of the interval.
  if(spans.some(s=>s.speakerId!==expected))return;
  const direct=spans.filter(s=>s.speakerId===expected);
  const covered=unionMs(direct.map(s=>({start:Math.max(start,s.startMs),end:Math.min(end,s.endMs)})).filter(s=>s.end>s.start));
  if(covered<minimumEvidence||end-start-covered>=minimumEvidence)return;
  const {alignment,hasDirectEvidence}=evaluateSpeakerSpan(timing,direct);
  if(!hasDirectEvidence||alignment?.speaker.speakerId!==expected||alignment.timing.overlap||
    (alignment.speaker.confidence??0)<DEFAULT_MINIMUM_CONFIDENCE)return;
  // Use the already confirmed turn reference, never mint a turn or change
  // ASR text/timing. Same-frame boundary confirmations otherwise leave a new
  // speaker's padded onset in the old turn and defeat the continuation check.
  const turnId=nearStart?boundary.nextTurnId:boundary.previousTurnId;
  return {...transcript,...(turnId?{turnId}:{}),speaker:alignment.speaker,timing:{...timing,overlap:false,activeSpeakerIds:[]}};
}

function simultaneousSpeakers(spans:SpeakerSpan[]) {
  const ids=new Set(spans.filter(s=>s.overlap===true).map(s=>s.speakerId));
  const latestEnd=new Map<string,number>();
  for(const span of [...spans].sort((a,b)=>a.startMs-b.startMs)){
    for(const [id,end] of latestEnd){
      if(end<=span.startMs)latestEnd.delete(id);
      else if(id!==span.speakerId){ids.add(id);ids.add(span.speakerId);}
    }
    latestEnd.set(span.speakerId,Math.max(latestEnd.get(span.speakerId)??-Infinity,span.endMs));
  }
  return [...ids];
}

function unionMs(spans:Array<{start:number;end:number}>) {
  const sorted=[...spans].sort((a,b)=>a.start-b.start);let end=-Infinity,total=0;
  for(const span of sorted){total+=Math.max(0,span.end-Math.max(span.start,end));end=Math.max(end,span.end);}
  return total;
}
