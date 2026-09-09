import {randomUUID} from "node:crypto";
import type {PublicModelAttemptEvent,TranslationLanguageCode} from "@translation/contracts";
import {isTranslationLanguage} from "@translation/contracts";
import {pcm16Wav} from "../speaker/recent-pcm-audio-buffer.js";
import {abortable} from "../providers/abortable.js";
import {readPublicJson,publicRequestMetadata} from "../providers/lmstudio/lmstudio-public-protocol.js";
import type {TranscriptResult} from "./asr-provider.js";
import {cleanRealtimeText} from "../protocol/realtime-text.js";
import {qwenAsrLanguage} from "./qwen-streaming-asr-protocol.js";
export interface CompletedAsrAudio {sessionId:string;segmentId:string;revision:number;complete:true;pcm:Uint8Array;
  sampleRate:16000|24000;startSample:number;sourceLanguage:TranslationLanguageCode;}
export interface CompletedAsrOptions {sessionId:string;leaseId:string;model:string;sampleRate:16000|24000;
  wireProfile?:"openai_transcriptions"|"qwen_asr_compatible";
  resolveCredentials:(signal?:AbortSignal)=>Promise<{apiKey?:string}>|{apiKey?:string};record:(e:PublicModelAttemptEvent)=>Promise<void>;}
export class PublicAsrError extends Error {constructor(readonly code:string,readonly outcome:"not_sent"|"rejected"|"uncertain"){super(code);}}
type Metadata=NonNullable<PublicModelAttemptEvent["metadata"]>;
export function parseOpenAiAsr(value:unknown,requestId:string|null){
  if(!value||typeof value!=="object"||Array.isArray(value))throw new PublicAsrError("public_asr_invalid_response","uncertain");
  const b=value as Record<string,any>,metadata:Metadata=publicRequestMetadata(requestId);
  if(typeof b.text!=="string"||b.text.length>16000||b.error!==undefined)throw new PublicAsrError("public_asr_invalid_response","uncertain");
  if(b.usage!==undefined){
    const u=b.usage,usage:NonNullable<Metadata["usage"]>={};
    const invalid=()=>{throw new PublicAsrError("public_asr_invalid_usage","uncertain");};
    if(!u||typeof u!=="object"||Array.isArray(u))return invalid();
    if(u.type==="duration"){
      if(typeof u.seconds!=="number"||!Number.isFinite(u.seconds)||u.seconds<0||u.seconds>3600)return invalid();usage.audioSeconds=u.seconds;
    }else if(u.type==="tokens"){
      for(const [wire,key]of [["input_tokens","promptTokens"],["output_tokens","completionTokens"],["total_tokens","totalTokens"]] as const){
        if(!Number.isSafeInteger(u[wire])||u[wire]<0)return invalid();usage[key]=u[wire];}
      if(u.input_token_details!==undefined){
        if(!u.input_token_details||typeof u.input_token_details!=="object"||Array.isArray(u.input_token_details))return invalid();
        for(const [wire,key]of [["audio_tokens","audioInputTokens"],["text_tokens","textInputTokens"]] as const){const n=u.input_token_details[wire];
          if(n!==undefined){if(!Number.isSafeInteger(n)||n<0)return invalid();usage[key]=n;}}
      }
    }else return invalid();
    metadata.usage=usage;
  }
  return {text:cleanRealtimeText(b.text)??"",metadata};
}
export function parseQwenCompletedAsr(value:unknown,requestId:string|null,language:string){
  const invalid=()=>{throw new PublicAsrError("public_asr_invalid_response","uncertain");};
  if(!value||typeof value!=="object"||Array.isArray(value))return invalid();
  const b=value as Record<string,any>,choice=b.choices?.[0];
  if(b.error!==undefined||!Array.isArray(b.choices)||b.choices.length!==1||choice?.finish_reason!=="stop"||choice.message?.role!=="assistant")return invalid();
  const annotations=choice.message.annotations;
  if(annotations!==undefined&&(!Array.isArray(annotations)||annotations.some((a:any)=>!a||typeof a!=="object"||a.type!=="audio_info"||a.language!==language)))return invalid();
  const u=b.usage;
  if(u!==undefined&&(!u||typeof u!=="object"||Array.isArray(u)))return invalid();
  const result=parseOpenAiAsr({text:choice.message.content,...(u!==undefined?{usage:{type:"tokens",input_tokens:u.prompt_tokens,
    output_tokens:u.completion_tokens,total_tokens:u.total_tokens,input_token_details:u.prompt_tokens_details}}:{})},requestId);
  if(u?.seconds!==undefined){
    if(typeof u.seconds!=="number"||!Number.isFinite(u.seconds)||u.seconds<0||u.seconds>3600)throw new PublicAsrError("public_asr_invalid_usage","uncertain");
    result.metadata.usage!.audioSeconds=u.seconds;
  }
  if(!result.metadata.requestId&&typeof b.id==="string")Object.assign(result.metadata,publicRequestMetadata(b.id));
  if(typeof b.model==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(b.model))result.metadata.reportedModel=b.model;
  return result;
}
type Send=<T>(url:string,init:RequestInit,consume:(r:Response)=>Promise<T>,signal?:AbortSignal)=>Promise<T>;
export async function transcribeCompletedAudio(input:CompletedAsrAudio,options:CompletedAsrOptions,endpoint:string,timeoutMs:number,send:Send,signal?:AbortSignal):Promise<TranscriptResult|null>{
  options={...options};
  const bad=()=>{throw new PublicAsrError("public_asr_invalid_input","not_sent");};
  if(options.wireProfile!==undefined&&!["openai_transcriptions","qwen_asr_compatible"].includes(options.wireProfile))return bad();
  const qwen=options.wireProfile==="qwen_asr_compatible";
  if(input.complete!==true||input.sessionId!==options.sessionId||!(input.pcm instanceof Uint8Array)||!input.pcm.byteLength||input.pcm.byteLength%2||
    ![16000,24000].includes(input.sampleRate)||input.sampleRate!==options.sampleRate||input.pcm.byteLength>input.sampleRate*2*30||
    !Number.isSafeInteger(input.startSample)||input.startSample<0||!Number.isSafeInteger(input.startSample+input.pcm.byteLength/2)||
    !Number.isSafeInteger(input.revision)||input.revision<0||!isTranslationLanguage(input.sourceLanguage)||!(qwen?/^[a-z]{2,3}$/:/^[a-z]{2}$/).test(input.sourceLanguage)||
    ![input.segmentId,options.sessionId,options.leaseId,options.model].every(v=>typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=240))return bad();
  if(qwen)qwenAsrLanguage(input.sourceLanguage);
  let url:URL;try{url=new URL(endpoint);}catch{return bad();}
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||!Number.isSafeInteger(timeoutMs)||timeoutMs<250||timeoutMs>120000)return bad();
  const base=endpoint.replace(/\/$/,""),suffix=qwen?"/chat/completions":"/audio/transcriptions";
  const target=base.endsWith(suffix)?base:`${base}${url.pathname==="/"?"/v1":""}${suffix}`;
  const snapshot={...input,pcm:Buffer.from(input.pcm)},controller=new AbortController(),cancel=()=>controller.abort();
  if(signal?.aborted)throw new PublicAsrError("public_asr_cancelled","not_sent");
  signal?.addEventListener("abort",cancel,{once:true});const timer=setTimeout(cancel,timeoutMs);
  const event:PublicModelAttemptEvent={sessionId:options.sessionId,leaseId:options.leaseId,attemptId:randomUUID(),segmentId:snapshot.segmentId,revision:snapshot.revision,
    component:"asr",providerId:qwen?"qwen":"openai",modelId:options.model,state:"dispatching",audioStartSample:snapshot.startSample,audioEndSample:snapshot.startSample+snapshot.pcm.length/2,audioSampleRate:snapshot.sampleRate};
  let prepared=false,sent=false,terminal=false;let metadata:Metadata|undefined;
  const record=async(e:PublicModelAttemptEvent)=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);try{await abortable(options.record(structuredClone(e)),c.signal);}finally{clearTimeout(t);}};
  try{
    let credentials:{apiKey?:string};try{credentials=await abortable(Promise.resolve().then(()=>options.resolveCredentials(controller.signal)),controller.signal);}catch{throw new PublicAsrError("public_asr_credentials_unavailable","not_sent");}
    if(typeof credentials.apiKey!=="string"||!credentials.apiKey.trim()||credentials.apiKey.trim()!==credentials.apiKey||/[\r\n]/.test(credentials.apiKey))throw new PublicAsrError("public_asr_credentials_unavailable","not_sent");
    const wav=pcm16Wav(snapshot.pcm,snapshot.sampleRate),headers:Record<string,string>={authorization:`Bearer ${credentials.apiKey}`};
    let body:BodyInit;
    if(qwen){
      headers["content-type"]="application/json";
      body=JSON.stringify({model:options.model,messages:[{role:"user",content:[{type:"input_audio",input_audio:{data:`data:audio/wav;base64,${wav.toString("base64")}`}}]}],
        stream:false,asr_options:{language:snapshot.sourceLanguage,enable_itn:false}});
    }else{
      const form=new FormData();form.set("model",options.model);form.set("language",snapshot.sourceLanguage);form.set("response_format","json");
      form.set("file",new Blob([new Uint8Array(wav)],{type:"audio/wav"}),"turn.wav");body=form;
    }
    try{await abortable(record(event),controller.signal);prepared=true;}catch{throw new PublicAsrError("public_asr_attempt_record_failed","not_sent");}
    if(controller.signal.aborted)throw new Error("aborted");
    sent=true;
    const result=await send(target,{method:"POST",headers,body,redirect:"error"},async response=>{
      metadata=publicRequestMetadata(response.headers.get("x-request-id"));
      if(!response.ok)throw new PublicAsrError(response.status===429?"public_asr_rate_limited":"public_asr_http_error",response.status>=500||response.status===408?"uncertain":"rejected");
      const value=await readPublicJson(response,controller.signal),id=response.headers.get("x-request-id");
      return qwen?parseQwenCompletedAsr(value,id,snapshot.sourceLanguage):parseOpenAiAsr(value,id);
    },controller.signal);
    metadata=result.metadata;terminal=true;try{await record({...event,state:"confirmed",metadata});}catch{throw new PublicAsrError("public_asr_attempt_record_failed","uncertain");}
    if(controller.signal.aborted)throw new Error("aborted");
    return result.text?{segmentId:snapshot.segmentId,revision:snapshot.revision,isFinal:true,text:result.text,language:snapshot.sourceLanguage,
      timing:{startMs:snapshot.startSample/snapshot.sampleRate*1000,endMs:event.audioEndSample!/snapshot.sampleRate*1000,source:"estimated"}}:null;
  }catch(error){
    const failure=error instanceof PublicAsrError?error:new PublicAsrError(controller.signal.aborted?(signal?.aborted?"public_asr_cancelled":"public_asr_timeout"):"public_asr_transport_or_response_error",sent?"uncertain":"not_sent");
    if(prepared&&!terminal){try{await record({...event,state:failure.outcome,failureCode:failure.code,...(metadata?{metadata}:{})});}catch{throw new PublicAsrError("public_asr_attempt_record_failed",sent?"uncertain":"not_sent");}}
    throw failure;
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",cancel);}
}
