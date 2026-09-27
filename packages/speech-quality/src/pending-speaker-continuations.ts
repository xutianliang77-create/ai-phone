import type {SpeechTranscript} from "./speech-transcript.js";
import {mergeTranscriptParts} from "./segment-text.js";
import {isSemanticContinuationCandidate,isSemanticContinuationTextCandidate,startsSemanticContinuation} from "./semantic-continuation-boundary.js";

interface Pending {parts:SpeechTranscript[];emittedAtMs:number;}
export interface LateSpeakerExpiry {
  elapsedMs:number;maxWindowMs:number;
  parts:Array<{segmentId:string;revision?:number;language:string;automaticLanguageStatus?:SpeechTranscript["automaticLanguageStatus"];mixedLanguage?:boolean;speakerId?:string;startMs?:number;endMs?:number}>;
}
/** Bounded retention inside the existing assembler. Originals are emitted
 * immediately; only validated late metadata can make a later text merge legal. */
export class PendingSpeakerContinuations {
  private readonly pending=new Map<string,Pending>();
  constructor(private readonly options:{enabled?:boolean;maxWindowMs:number;maxSemanticParts?:number;
    maxSemanticCharacters?:number;semanticSourceLanguage?:string;onLateSpeakerExpiry?:(id:string,info:LateSpeakerExpiry)=>void},
    private readonly canJoin:(a:SpeechTranscript,b:SpeechTranscript)=>boolean){}

  remember(id:string,t:SpeechTranscript,now:number,partCount:number){
    if(!this.options.enabled)return;
    if(partCount!==1||Array.from(t.text).length>=Math.min(180,this.options.maxSemanticCharacters??180)||
      !isSemanticContinuationTextCandidate(t,this.options.semanticSourceLanguage)){
      this.clear(id);return;
    }
    let old=this.active(id,now);
    const index=old?.parts.findIndex(p=>p.segmentId===t.segmentId)??-1;
    if(old&&index>=0){
      if((t.revision??0)>(old.parts[index].revision??0))old.parts[index]=structuredClone(t);
      return;
    }
    if(old){
      const prefix=mergeTranscriptParts(old.parts,{joinSemanticContinuation:true});
      if(old.parts.length>=Math.min(3,this.options.maxSemanticParts??3)||
        Array.from(prefix.text+t.text).length>Math.min(180,this.options.maxSemanticCharacters??180)||
        prefix.language!==t.language||prefix.turnId!==t.turnId||!startsSemanticContinuation(t,prefix))old=undefined;
    }
    this.pending.set(id,old?{...old,parts:[...old.parts,structuredClone(t)]}:{parts:[structuredClone(t)],emittedAtMs:now});
  }
  hasUnresolved(id:string,now:number){
    return this.active(id,now)?.parts.some(p=>!isSemanticContinuationCandidate(p,this.options.semanticSourceLanguage))??false;
  }
  refresh(id:string,project:(parts:SpeechTranscript[])=>SpeechTranscript[],now:number){
    const pending=this.active(id,now);if(!pending)return;
    const parts=project(structuredClone(pending.parts));
    if(parts.length!==pending.parts.length||parts.some((p,i)=>!sameOriginal(p,pending.parts[i]))){this.clear(id);return;}
    pending.parts=parts;
    if(!parts.every(p=>isSemanticContinuationCandidate(p,this.options.semanticSourceLanguage)))return;
    let merged=parts[0];
    for(let i=1;i<parts.length;i++){
      if(!startsSemanticContinuation(parts[i],merged)||!this.canJoin(merged,parts[i]))return;
      merged=mergeTranscriptParts(parts.slice(0,i+1),{joinSemanticContinuation:true});
    }
    if(Array.from(merged.text).length>Math.min(180,this.options.maxSemanticCharacters??180))return;
    // Include inter-fragment gaps: a rival there cannot be hidden by separately
    // assigning each fragment to the same dominant slot.
    const whole=project([structuredClone(merged)])[0];
    if(!whole||!sameOriginal(whole,merged)||!isSemanticContinuationCandidate(whole,this.options.semanticSourceLanguage)||
      whole.speaker?.speakerId!==merged.speaker?.speakerId)return;
    const result={...pending,parts,transcript:whole};
    if(parts.length>1)this.clear(id);
    return result;
  }
  clear(id:string){this.pending.delete(id);}
  expire(id:string,now:number){this.active(id,now);}
  private active(id:string,now:number){
    const item=this.pending.get(id);
    if(item&&now-item.emittedAtMs<=Math.min(5000,this.options.maxWindowMs))return item;
    if(item&&this.options.onLateSpeakerExpiry){
      try{this.options.onLateSpeakerExpiry(id,{elapsedMs:now-item.emittedAtMs,maxWindowMs:Math.min(5000,this.options.maxWindowMs),
        parts:item.parts.map(p=>({segmentId:p.segmentId,revision:p.revision,language:p.language,automaticLanguageStatus:p.automaticLanguageStatus,
          mixedLanguage:p.mixedLanguage,speakerId:p.speaker?.speakerId,startMs:p.timing?.startMs,endMs:p.timing?.endMs}))});}catch{/* Diagnostics never change the bounded decision. */}
    }
    this.clear(id);return undefined;
  }
}

function sameOriginal(a:SpeechTranscript,b:SpeechTranscript){
  return a.segmentId===b.segmentId&&a.text===b.text&&a.language===b.language&&a.turnId===b.turnId&&a.revision===b.revision&&
    a.automaticLanguageStatus===b.automaticLanguageStatus&&a.mixedLanguage===b.mixedLanguage&&a.endpointReason===b.endpointReason&&
    a.timing?.startMs===b.timing?.startMs&&a.timing?.endMs===b.timing?.endMs&&a.timing?.source===b.timing?.source;
}
