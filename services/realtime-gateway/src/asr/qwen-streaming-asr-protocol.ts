import {PublicAsrError} from "./public-asr-completed-audio.js";
import type {TranslationLanguageCode,PublicAsrServerVad} from "@translation/contracts";
import {QWEN_ASR_PRODUCT_LANGUAGES,automaticSourceAllowed,resolvePublicAsrServerVad} from '@translation/contracts';
/** Intersection of the documented Qwen language codes and the existing product
 * language contract. `auto` deliberately omits the optional Qwen hint; it is
 * not coerced to a default language or an unqualified language pair. */
const supported:ReadonlySet<string>=new Set(QWEN_ASR_PRODUCT_LANGUAGES);
// Valid supplier evidence is not an authorization to translate a new language.
const supplierOnly=new Set(["da","fil","fi","is","no","sv"]);
export function qwenAsrLanguage(language:string){
  if(!supported.has(language))throw new PublicAsrError("qwen_asr_language_not_supported","not_sent");return language;
}
export function qwenTranscriptLanguage(language:unknown,source:string,_pair?:readonly TranslationLanguageCode[],_sourceLanguages?:readonly TranslationLanguageCode[]):TranslationLanguageCode|undefined{
  if(typeof language!=="string"||!/^[a-z]{2,3}$/.test(language))throw new PublicAsrError("qwen_asr_language_invalid","uncertain");
  if(source!=="auto"){
    if(language!==source)throw new PublicAsrError("qwen_asr_language_mismatch","uncertain");
  }else if(supplierOnly.has(language))return undefined;
  else if(!supported.has(language))throw new PublicAsrError("qwen_asr_language_not_supported","uncertain");
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
    return detected===undefined||source==='auto'&&!automaticSourceAllowed({pair,sourceLanguages},detected)?undefined:detected;
  }
  catch(error){
    if(error instanceof PublicAsrError&&["qwen_asr_language_not_supported","qwen_asr_language_mismatch"].includes(error.code))return undefined;
    throw error;
  }
}
/** Official DashScope TranscriptionParams.corpus_text serializes here. These
 * are soft vocabulary hints, never transcript replacements or language hints. */
export function qwenAsrCorpus(hotwords:readonly string[]=[]):string|undefined {
  const words:string[]=[];let bytes=0;
  for(const word of [...new Set(hotwords)]) {
    if(typeof word!=="string"||!word.trim()||word!==word.trim()||word.length>120||/[\u0000-\u001f\u007f]/u.test(word))
      throw new PublicAsrError("qwen_asr_corpus_invalid","not_sent");
    const size=Buffer.byteLength(word)+1;
    if(words.length>=120||bytes+size>6000)break;
    words.push(word);bytes+=size;
  }
  return words.length?words.join("\n"):undefined;
}
export function qwenAsrSessionConfiguration(language:string,serverVad?:PublicAsrServerVad,corpus?:string){
  const vad=resolvePublicAsrServerVad("qwen_asr_realtime",serverVad)!;
  const inputAudioTranscription={...(language==="auto"?{}:{language:qwenAsrLanguage(language)}),...(corpus?{corpus:{text:corpus}}:{})};
  return {input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:inputAudioTranscription,
    // Qwen documents Manual mode for short, explicitly submitted voice
    // messages and recommends no more than 60 seconds of cumulative audio.
    // Public Wujie sessions are continuous conversations, so supplier-side VAD
    // owns ASR segmentation. The phone VAD remains independent and continues
    // to own local barge-in/playback/UI behavior.
    turn_detection:{type:"server_vad",threshold:vad.threshold,silence_duration_ms:vad.silenceDurationMs}};
}
export function assertQwenAsrConfiguration(session:Record<string,any>|undefined,model:string,language:string,serverVad?:PublicAsrServerVad,corpus?:string){
  const vad=resolvePublicAsrServerVad("qwen_asr_realtime",serverVad)!;
  const transcription=session?.input_audio_transcription;
  const transcriptionOk=language==="auto"
    ? transcription===undefined||autoTranscription(transcription,model,corpus)
    : fixedTranscription(transcription,model,qwenAsrLanguage(language),corpus);
  if(!session||typeof session.id!=="string"||!session.id||session.id.length>240||session.model!==model||
    JSON.stringify(session.modalities)!=='["text"]'||!["pcm","pcm16"].includes(session.input_audio_format)||session.sample_rate!==16000||
    !transcriptionOk||session.turn_detection?.type!=="server_vad"||session.turn_detection.threshold!==vad.threshold||
    session.turn_detection.silence_duration_ms!==vad.silenceDurationMs||Object.keys(session.turn_detection).some(key=>
      !["type","threshold","silence_duration_ms","create_response","interrupt_response"].includes(key))||
    ["create_response","interrupt_response"].some(key=>session.turn_detection[key]!==undefined&&typeof session.turn_detection[key]!=="boolean"))throw new PublicAsrError("qwen_asr_setup_mismatch","not_sent");
}
/** Qwen omits optional fields in a source=auto acknowledgement, but it must
 * never echo a fixed language or a different transcription model. */
function corpusEcho(value:Record<string,unknown>,corpus?:string) {
  // Omission is not proof of supplier use; a present echo must be exact.
  return value.corpus===undefined||!!corpus&&JSON.stringify(value.corpus)===JSON.stringify({text:corpus});
}
function autoTranscription(value:unknown,model:string,corpus?:string){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["model","language","corpus"].includes(key)))return false;
  const item=value as Record<string,unknown>;
  return (item.model===undefined||item.model===model)&&item.language===undefined&&corpusEcho(item,corpus);
}
function fixedTranscription(value:unknown,model:string,language:string,corpus?:string){
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(key=>!["model","language","corpus"].includes(key)))return false;
  const item=value as Record<string,unknown>;
  return item.language===language&&(item.model===undefined||item.model===model)&&corpusEcho(item,corpus);
}
