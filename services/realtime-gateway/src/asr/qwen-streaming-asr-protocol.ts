import {PublicAsrError} from "./public-asr-completed-audio.js";
/** Intersection of the documented Qwen language codes and the existing product
 * language contract. No automatic detection, script conversion or guessed alias. */
const supported=new Set(["zh","yue","en","ja","de","ko","ru","fr","pt","ar","it","es","hi","id","th","tr","uk","vi","cs","ms","pl"]);
export function qwenAsrLanguage(language:string){
  if(!supported.has(language))throw new PublicAsrError("qwen_asr_language_not_supported","not_sent");return language;
}
export function qwenAsrSessionConfiguration(language:string){return {input_audio_format:"pcm",sample_rate:16000,input_audio_transcription:{language:qwenAsrLanguage(language)},turn_detection:null};}
export function assertQwenAsrConfiguration(session:Record<string,any>|undefined,model:string,language:string){
  if(!session||typeof session.id!=="string"||!session.id||session.id.length>240||session.model!==model||
    JSON.stringify(session.modalities)!=='["text"]'||!["pcm","pcm16"].includes(session.input_audio_format)||session.sample_rate!==16000||
    session.input_audio_transcription?.language!==language||session.turn_detection!==null)throw new PublicAsrError("qwen_asr_setup_mismatch","not_sent");
}
