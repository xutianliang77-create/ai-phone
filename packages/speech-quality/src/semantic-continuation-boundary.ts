import type {SpeechTranscript} from "./speech-transcript.js";
import {shouldHoldForNextSegment} from "./segment-boundary.js";
import {isObjectEnumerationContinuation} from "./semantic-object-boundary.js";

/** Conservative lexical evidence, not a model-specific endpoint or a guessed
 * speaker. A public supplier's full stop alone does not close a logical clause. */
export function isSemanticContinuationCandidate(value:SpeechTranscript,fixedSourceLanguage?:string) {
  return (value.language==="zh"||value.language==="en")&&
    (!fixedSourceLanguage||fixedSourceLanguage==="auto"||value.language===fixedSourceLanguage)&&
    (value.endpointReason===undefined||value.endpointReason==="silence")&&
    (value.automaticLanguageStatus===undefined||value.automaticLanguageStatus==="detected")&&
    // Text-script mixing is not an acoustic language change. Keep the flag,
    // but use actual provider confirmation (or the fixed session source) here.
    (value.mixedLanguage!==true||value.automaticLanguageStatus==="detected"||
      value.automaticLanguageStatus===undefined&&fixedSourceLanguage===value.language)&&
    !!value.turnId&&!!value.speaker&&
    value.speaker.speakerId!=="unknown"&&value.speaker.role!=="unknown"&&value.speaker.source!=="unknown"&&
    !!value.timing&&Number.isFinite(value.timing.startMs)&&Number.isFinite(value.timing.endMs)&&
    value.timing.endMs>value.timing.startMs&&value.timing.overlap!==true&&
    (value.timing.activeSpeakerIds??[]).every(id=>id===value.speaker!.speakerId)&&
    /[.。]$/u.test(value.text.trim())&&!shouldHoldForNextSegment(value.text,value.language)&&
    // Short answers remain independent and immediate; this does not filter,
    // delete or rewrite their recognized text.
    !/^(?:ok(?:ay)?|yes|no|hello|hi|thanks?|thank you|好|好的|对|是|可以|谢谢|你好)[.。]$/iu.test(value.text.trim());
}

export function startsSemanticContinuation(value:SpeechTranscript,previous?:SpeechTranscript) {
  const text=value.text.trim();
  if(/[!?！？]$/u.test(text))return false;
  if(previous&&isObjectEnumerationContinuation(previous.text,text,value.language))return true;
  if(value.language==="zh")return /^(?:并且|并(?!不是|非)|而且|以及)\S/u.test(text);
  if(value.language==="en")return /^and\s+\S/iu.test(text);
  return false;
}
