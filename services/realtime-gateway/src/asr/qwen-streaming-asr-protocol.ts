import {PublicAsrError} from "./public-asr-completed-audio.js";
/** Intersection of the documented Qwen language codes and the existing product
 * language contract. `auto` deliberately omits the optional Qwen hint; it is
 * not coerced to a default language or an unqualified language pair. */
const supported=new Set(["zh","yue","en","ja","de","ko","ru","fr","pt","ar","it","es","hi","id","th","tr","uk","vi","cs","ms","pl"]);
export function qwenAsrLanguage(language:string){
  if(!supported.has(language))throw new PublicAsrError("qwen_asr_language_not_supported","not_sent");return language;
}
export function qwenAsrSessionConfiguration(language:string){
  const inputAudioTranscription=language==="auto"?{}:{language:qwenAsrLanguage(language)};
  return {input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:inputAudioTranscription,
    // Qwen documents Manual mode for short, explicitly submitted voice
    // messages and recommends no more than 60 seconds of cumulative audio.
    // Public Wujie sessions are continuous conversations, so supplier-side VAD
    // owns ASR segmentation. The phone VAD remains independent and continues
    // to own local barge-in/playback/UI behavior.
    turn_detection:{type:"server_vad",threshold:0,silence_duration_ms:400}};
}
export function assertQwenAsrConfiguration(session:Record<string,any>|undefined,model:string,language:string){
  const transcription=session?.input_audio_transcription;
  const transcriptionOk=language==="auto"
    ? transcription===undefined||autoTranscription(transcription,model)
    : fixedTranscription(transcription,model,qwenAsrLanguage(language));
  if(!session||typeof session.id!=="string"||!session.id||session.id.length>240||session.model!==model||
    JSON.stringify(session.modalities)!=='["text"]'||!["pcm","pcm16"].includes(session.input_audio_format)||session.sample_rate!==16000||
    !transcriptionOk||session.turn_detection?.type!=="server_vad"||session.turn_detection.threshold!==0||
    session.turn_detection.silence_duration_ms!==400||Object.keys(session.turn_detection).some(key=>
      !["type","threshold","silence_duration_ms"].includes(key)))throw new PublicAsrError("qwen_asr_setup_mismatch","not_sent");
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
