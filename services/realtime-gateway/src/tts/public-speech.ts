import {randomUUID} from "node:crypto";
import type {PublicModelAttemptEvent, RealtimeVoiceConfig, TranslationEvent} from "@translation/contracts";
import {abortable} from "../providers/abortable.js";
import {publicRequestMetadata} from "../providers/lmstudio/lmstudio-public-protocol.js";
import type WebSocket from "ws";
import {qwenSpeechPcm,qwenSpeechLanguage} from "./qwen-speech.js";
import {tencentSpeechPcm,validateTencentSpeech} from "./tencent-speech.js";
import {googleSpeechPcm,googleSpeechConfiguration,googleSpeechCredentials} from "./google-speech.js";

export interface PublicSpeechCredentials {apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string;}

export interface PublicSpeechOptions {
  sessionId:string; leaseId:string; endpoint:string; modelId:string; voice:string; targetLanguage:string;
  timeoutMs:number; prefillMs:number;
  resolveCredentials:(signal?:AbortSignal)=>Promise<PublicSpeechCredentials>|PublicSpeechCredentials;
  record:(event:PublicModelAttemptEvent)=>Promise<void>;
  fetchFn?:typeof fetch;
  protocol?:"openai_speech"|"qwen_tts_realtime"|"tencent_tts_ws"|"google_cloud_tts";
  appId?:string;projectId?:string;sampleRate?:16000|24000;
  socketFactory?:(url:string,options:WebSocket.ClientOptions)=>WebSocket;
}
export class PublicSpeechError extends Error {
  constructor(readonly code:string,readonly outcome:"not_sent"|"rejected"|"uncertain"){super(code);}
}
export function validatePublicSpeech(options:PublicSpeechOptions) {
  const key=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(v);
  let url:URL;try{url=new URL(options.endpoint);}catch{throw new PublicSpeechError("public_tts_configuration","not_sent");}
  if(url.protocol!==(["qwen_tts_realtime","tencent_tts_ws"].includes(options.protocol??"")?"wss:":"https:")||url.username||url.password||url.search||url.hash||
    ![options.sessionId,options.leaseId,options.modelId,options.voice].every(key)||
    !Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<250||options.timeoutMs>120000||
    !Number.isSafeInteger(options.prefillMs)||options.prefillMs<20||options.prefillMs>1000||
    (options.sampleRate!==undefined&&![16000,24000].includes(options.sampleRate))||
    (!["tencent_tts_ws","google_cloud_tts"].includes(options.protocol??"")&&options.sampleRate!==undefined&&options.sampleRate!==24000)||
    typeof options.record!=="function"||typeof options.resolveCredentials!=="function")throw new PublicSpeechError("public_tts_configuration","not_sent");
  if(options.protocol==="qwen_tts_realtime"){qwenSpeechLanguage(options.targetLanguage);return url.toString();}
  if(options.protocol==="tencent_tts_ws"){validateTencentSpeech(options);return url.toString();}
  if(options.protocol==="google_cloud_tts")return googleSpeechConfiguration(options).url;
  const base=url.pathname.replace(/\/+$/,"");url.pathname=base.endsWith("/audio/speech")?base:`${base||"/v1"}/audio/speech`;
  return url.toString();
}

/** Binary wire adapter consumed by the original HttpTtsSynthesizer. No retry,
 * resampling, voice cloning, private defaults or fabricated provider usage. */
export async function* publicSpeechPcm(options:PublicSpeechOptions,event:TranslationEvent,voice:RealtimeVoiceConfig|undefined,
  signal:AbortSignal):AsyncIterable<Buffer> {
  const endpoint=validatePublicSpeech(options),text=event.text.trim();
  if(event.type!=="translation.final"||event.sessionId!==options.sessionId||event.language!==options.targetLanguage||
    !text||[...text].length>4096||options.protocol==="tencent_tts_ws"&&/<\/?[A-Za-z][^>]*>/.test(text)||!Number.isSafeInteger(event.revision)||event.revision!<0||
    options.protocol==="google_cloud_tts"&&Buffer.byteLength(text)>5000||
    !/^[A-Za-z0-9_.:/-]{1,240}$/.test(event.segmentId)||
    voice!==undefined&&(voice.mode!=="preset"||voice.presetId!==options.voice||Object.keys(voice).some(k=>!["mode","presetId"].includes(k)))) {
    throw new PublicSpeechError("public_tts_input_scope","not_sent");
  }
  const attempt:PublicModelAttemptEvent={sessionId:event.sessionId,leaseId:options.leaseId,attemptId:randomUUID(),
    segmentId:event.segmentId,revision:event.revision!,component:"tts",providerId:options.protocol==="qwen_tts_realtime"?"qwen":options.protocol==="tencent_tts_ws"?"tencent":options.protocol==="google_cloud_tts"?"google":"openai",modelId:options.modelId,state:"dispatching"};
  let prepared=false,sent=false,terminal=false,rejected=false;
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,metadata:PublicModelAttemptEvent["metadata"];
  const record=async(e:PublicModelAttemptEvent)=>{
    const c=new AbortController(),timer=setTimeout(()=>c.abort(),5000);
    try{await abortable(Promise.resolve().then(()=>options.record(structuredClone(e))),c.signal);}
    catch{throw new PublicSpeechError("public_tts_attempt_record_failed",sent?"uncertain":"not_sent");}
    finally{clearTimeout(timer);}
  };
  const check=()=>{if(signal.aborted)throw new PublicSpeechError("public_tts_cancelled",sent?"uncertain":"not_sent");};
  try {
    check();const credentials=await abortable(Promise.resolve().then(()=>options.resolveCredentials(signal)),signal);check();
    const token=credentials?.apiKey;
    if(!["tencent_tts_ws","google_cloud_tts"].includes(options.protocol??"")&&(typeof token!=="string"||!token.trim()||token.trim()!==token||/[\r\n]/.test(token)))throw new PublicSpeechError("public_tts_credentials_unavailable","not_sent");
    if(options.protocol==="tencent_tts_ws"&&(!credentials.secretId||!credentials.secretKey))throw new PublicSpeechError("public_tts_credentials_unavailable","not_sent");
    if(options.protocol==="google_cloud_tts")googleSpeechCredentials(options,credentials);
    // If the durable write is slow, do not race it then send. Cancellation is
    // rechecked after its bounded completion; unresolved intent stays unknown.
    await record(attempt);prepared=true;check();
    let source:AsyncIterable<Uint8Array>,length:string|null=null;
    if(options.protocol==="qwen_tts_realtime"){
      metadata={};source=qwenSpeechPcm(options,text,token!,signal,()=>{sent=true;},metadata);
    }else if(options.protocol==="tencent_tts_ws"){
      metadata={};source=tencentSpeechPcm(options,text,credentials,signal,()=>{sent=true;},metadata);
    }else if(options.protocol==="google_cloud_tts"){
      metadata={};source=googleSpeechPcm(options,text,credentials,signal,()=>{sent=true;},metadata);
    }else{
    sent=true;
    const response=await abortable((options.fetchFn??fetch)(endpoint,{method:"POST",redirect:"error",signal,
      headers:{"content-type":"application/json",authorization:`Bearer ${token}`},
      body:JSON.stringify({model:options.modelId,input:text,voice:options.voice,response_format:"pcm"})}),signal);
    metadata=publicRequestMetadata(response.headers.get("x-request-id"));check();
    if(!response.ok){void response.body?.cancel().catch(()=>{});rejected=[400,401,403,404,422,429].includes(response.status);
      throw new PublicSpeechError("public_tts_http_failed",rejected?"rejected":"uncertain");}
    const mime=response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if(!["application/octet-stream","audio/pcm"].includes(mime??"")||!response.body){void response.body?.cancel().catch(()=>{});throw new PublicSpeechError("public_tts_audio_format","uncertain");}
    const maxBytes=24000*2*120;length=response.headers.get("content-length");
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)<2||Number(length)>maxBytes||Number(length)%2)) {
      void response.body.cancel().catch(()=>{});throw new PublicSpeechError("public_tts_audio_size","uncertain");
    }
    reader=response.body.getReader();
    source=(async function*(){while(true){const next=await abortable(reader!.read(),signal);check();if(next.done)return;yield next.value;}})();
    }
    let pending=Buffer.alloc(0),total=0;const rate=options.sampleRate??24000,maxBytes=rate*2*120;
    const frameBytes=options.prefillMs*rate*2/1000;
    for await(const value of source){check();
      total+=value.byteLength;if(total>maxBytes)throw new PublicSpeechError("public_tts_audio_size","uncertain");
      pending=Buffer.concat([pending,Buffer.from(value)]);
      // Leave a final frame for confirmed EOF/journal. Network chunks may split a sample.
      while(pending.length>frameBytes){check();yield pending.subarray(0,frameBytes);pending=pending.subarray(frameBytes);}
    }
    if(total<2||total%2||length!==null&&total!==Number(length))throw new PublicSpeechError("public_tts_audio_incomplete","uncertain");
    terminal=true;await record({...attempt,state:"confirmed",metadata});check();
    if(pending.length)yield pending;
  } catch(error) {
    if(error instanceof PublicSpeechError&&error.outcome==="rejected")rejected=true;
    if(prepared&&!terminal){terminal=true;await record({...attempt,state:sent?(rejected?"rejected":"uncertain"):"not_sent",
      failureCode:error instanceof PublicSpeechError?error.code:"public_tts_transport_failed",...(metadata?{metadata}:{})});}
    if(error instanceof PublicSpeechError)throw error;
    throw new PublicSpeechError(signal.aborted?"public_tts_cancelled":"public_tts_transport_failed",sent?"uncertain":"not_sent");
  } finally {
    if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}
    // Async iterator return (stop during a yield) is not successful completion.
    if(prepared&&!terminal)await record({...attempt,state:sent?"uncertain":"not_sent",failureCode:"public_tts_consumer_stopped",...(metadata?{metadata}:{})});
  }
}
