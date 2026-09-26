import type {SpeechTranscript} from "./speech-transcript.js";

/** Bounded metadata only; never retain PCM or another copy of the text. */
export interface TranscriptDuplicateScope {
  language:string;
  speakerId:string;
  turnId:string;
  protectedBoundary:boolean;
  range?:{startMs:number;endMs:number};
}

export function transcriptDuplicateScope(transcript:SpeechTranscript):TranscriptDuplicateScope {
  const timing=transcript.timing,speaker=transcript.speaker;
  const validRange=timing&&Number.isFinite(timing.startMs)&&Number.isFinite(timing.endMs)&&
    timing.startMs>=0&&timing.endMs>timing.startMs;
  return {language:transcript.language,speakerId:speaker?.speakerId??"",turnId:transcript.turnId??"",
    protectedBoundary:timing?.overlap===true||speaker?.speakerId==="unknown"||speaker?.role==="unknown"||speaker?.source==="unknown",
    ...(validRange?{range:{startMs:timing.startMs,endMs:timing.endMs}}:{})};
}

/** Text equality alone cannot collapse two timestamped utterances, speakers,
 * turns or languages. Without timing evidence retain the inherited bounded
 * duplicate heuristic; this is not an acoustic silence/VAD decision. */
export function mayBeSameRecognizedSpeech(previous:TranscriptDuplicateScope,incoming:TranscriptDuplicateScope){
  if(previous.protectedBoundary||incoming.protectedBoundary||previous.language!==incoming.language||
    previous.speakerId!==incoming.speakerId||previous.turnId!==incoming.turnId)return false;
  const a=previous.range,b=incoming.range;
  return !a||!b||a.endMs>b.startMs&&b.endMs>a.startMs;
}
