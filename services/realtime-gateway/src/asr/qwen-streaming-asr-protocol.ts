import {PublicAsrError} from "./public-asr-completed-audio.js";
import type {TranslationLanguageCode} from "@translation/contracts";
import {QWEN_ASR_PRODUCT_LANGUAGES,automaticSourceAllowed} from '@translation/contracts';
/** Intersection of the documented Qwen language codes and the existing product
 * language contract. `auto` deliberately omits the optional Qwen hint; it is
 * not coerced to a default language or an unqualified language pair. */
const supported:ReadonlySet<string>=new Set(QWEN_ASR_PRODUCT_LANGUAGES);
export function qwenAsrLanguage(language:string){
  if(!supported.has(language))throw new PublicAsrError("qwen_asr_language_not_supported","not_sent");return language;
}
export function qwenTranscriptLanguage(language:unknown,source:string,_pair?:readonly TranslationLanguageCode[],_sourceLanguages?:readonly TranslationLanguageCode[]):TranslationLanguageCode{
  if(typeof language!=="string"||!/^[a-z]{2,3}$/.test(language))throw new PublicAsrError("qwen_asr_language_invalid","uncertain");
  if(source!=="auto"){
    if(language!==source)throw new PublicAsrError("qwen_asr_language_mismatch","uncertain");
  }else if(!supported.has(language))throw new PublicAsrError("qwen_asr_language_not_supported","uncertain");
  // Partial language is provisional, just like stash. Qwen may revise en -> zh
  // within one item; only completed supplies the language routed to MT.
  return language as TranslationLanguageCode;
}
/** A draft is not a final language decision. Suppress an out-of-scope preview,
 * but keep accepting its audio and await completed. Never coerce it into the
 * signed pair or weaken final-result, item or payload validation. */
export function qwenDraftTranscriptLanguage(language:unknown,source:string,pair?:readonly TranslationLanguageCode[],sourceLanguages?:readonly TranslationLanguageCode[]){
  try{
    const detected=qwenTranscriptLanguage(language,source,pair,sourceLanguages);
    return source==='auto'&&!automaticSourceAllowed({pair,sourceLanguages},detected)?undefined:detected;
  }
  catch(error){
    if(error instanceof PublicAsrError&&["qwen_asr_language_not_supported","qwen_asr_language_mismatch"].includes(error.code))return undefined;
    throw error;
  }
}
export function qwenAsrSessionConfiguration(language:string){
  const inputAudioTranscription=language==="auto"?{}:{language:qwenAsrLanguage(language)};
  return {input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:inputAudioTranscription,
    // Qwen documents Manual mode for short, explicitly submitted voice
    // messages and recommends no more than 60 seconds of cumulative audio.
    // Public Wujie sessions are continuous conversations, so supplier-side VAD
    // owns ASR segmentation. The phone VAD remains independent and continues
    // to own local barge-in/playback/UI behavior.
    turn_detection:{type:"server_vad",threshold:0.2,silence_duration_ms:400}};
}
export function assertQwenAsrConfiguration(session:Record<string,any>|undefined,model:string,language:string){
  const transcription=session?.input_audio_transcription;
  const transcriptionOk=language==="auto"
    ? transcription===undefined||autoTranscription(transcription,model)
    : fixedTranscription(transcription,model,qwenAsrLanguage(language));
  if(!session||typeof session.id!=="string"||!session.id||session.id.length>240||session.model!==model||
    JSON.stringify(session.modalities)!=='["text"]'||!["pcm","pcm16"].includes(session.input_audio_format)||session.sample_rate!==16000||
    !transcriptionOk||session.turn_detection?.type!=="server_vad"||session.turn_detection.threshold!==0.2||
    session.turn_detection.silence_duration_ms!==400||Object.keys(session.turn_detection).some(key=>
      !["type","threshold","silence_duration_ms","create_response","interrupt_response"].includes(key))||
    ["create_response","interrupt_response"].some(key=>session.turn_detection[key]!==undefined&&typeof session.turn_detection[key]!=="boolean"))throw new PublicAsrError("qwen_asr_setup_mismatch","not_sent");
}
/** Qwen omits optional fields in a source=auto acknowledgement, but it must
 * never echo a fixed language or a different transcription model. */
function autoTranscription(value:unknown,model:string){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["model","language"].includes(key)))return false;
  const item=value as Record<string,unknown>;
  return (item.model===undefined||item.model===model)&&item.language===undefined;
}
function fixedTranscription(value:unknown,model:string,language:string){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["model","language"].includes(key)))return false;
  const item=value as Record<string,unknown>;
  return item.language===language&&(item.model===undefined||item.model===model);
}
