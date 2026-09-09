import WebSocket from "ws";
import {createHmac,randomUUID} from "node:crypto";
import type {PublicModelAttemptEvent} from "@translation/contracts";
import {PublicSpeechError,type PublicSpeechOptions} from "./public-speech.js";
import {abortable} from "../providers/abortable.js";
const key=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(v);
const integer=(v:unknown)=>typeof v==="string"&&/^[1-9][0-9]{0,15}$/.test(v)&&Number.isSafeInteger(Number(v));
export function validateTencentSpeech(options:PublicSpeechOptions){
  const url=new URL(options.endpoint);
  if(url.protocol!=="wss:"||url.pathname!=="/stream_wsv2"||url.username||url.password||url.search||url.hash||
    !integer(options.appId)||!integer(options.voice)||options.voice==="200000000"||
    ![16000,24000].includes(options.sampleRate??24000)||!["zh","en"].includes(options.targetLanguage))throw new PublicSpeechError("tencent_tts_configuration","not_sent");
}
/** Signed URL stays in transport memory. Never log it: it contains SecretId and
 * an expiring signature. SecretKey and user text are never URL parameters. */
export function tencentSpeechUrl(options:PublicSpeechOptions,credentials:{secretId?:string;secretKey?:string},wireId:string,now=Date.now()){
  validateTencentSpeech(options);
  if(!key(credentials.secretId)||typeof credentials.secretKey!=="string"||!credentials.secretKey||credentials.secretKey.length>4096||
    credentials.secretKey.trim()!==credentials.secretKey||/[\u0000-\u001f\u007f]/u.test(credentials.secretKey)||!key(wireId)||!Number.isFinite(now)||now<0)throw new PublicSpeechError("tencent_tts_credentials_unavailable","not_sent");
  const url=new URL(options.endpoint),timestamp=Math.floor(now/1000);
  const params:Record<string,string>={Action:"TextToStreamAudioWSv2",AppId:options.appId!,Codec:"pcm",Expired:String(timestamp+Math.ceil(options.timeoutMs/1000)+30),
    SampleRate:String(options.sampleRate??24000),SecretId:credentials.secretId!,SessionId:wireId,Timestamp:String(timestamp),VoiceType:options.voice};
  const entries=Object.entries(params).sort(([a],[b])=>a<b?-1:a>b?1:0);
  const canonical=entries.map(([k,v])=>`${k}=${v}`).join("&");
  const signature=createHmac("sha1",credentials.secretKey!).update(`GET${url.host}${url.pathname}?${canonical}`).digest("base64");
  url.search=entries.map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")+`&Signature=${encodeURIComponent(signature)}`;
  return url.toString();
}

/** Stream-WSv2 wire only; uses the original shared deadline/journal/PCM queue. */
export async function* tencentSpeechPcm(options:PublicSpeechOptions,text:string,credentials:{secretId?:string;secretKey?:string},signal:AbortSignal,
  markSent:()=>void,metadata:NonNullable<PublicModelAttemptEvent["metadata"]>):AsyncIterable<Buffer> {
  const wireId=randomUUID(),url=tencentSpeechUrl(options,credentials,wireId);
  let ws:WebSocket|undefined,failure:PublicSpeechError|undefined,wake=()=>{},ready=false,submitted=false,completing=false,finished=false,requestId:string|undefined;
  let queuedBytes=0,totalBytes=0;const queue:Buffer[]=[],seen=new Set<string>(),rate=options.sampleRate??24000;
  const fail=(code:string)=>{if(failure)return;failure=new PublicSpeechError(code,submitted?"uncertain":"not_sent");wake();ws?.terminate();};
  const check=()=>{if(signal.aborted)fail("tencent_tts_cancelled");if(failure)throw failure;};
  const wait=async(predicate:()=>boolean)=>{while(!predicate()){check();await new Promise<void>(r=>wake=r);}check();};
  const send=async(action:string,data:string)=>{check();if(ws?.readyState!==WebSocket.OPEN||ws.bufferedAmount>1048576)throw new PublicSpeechError("tencent_tts_backpressure",submitted?"uncertain":"not_sent");
    await abortable(new Promise<void>((resolve,reject)=>ws!.send(JSON.stringify({session_id:wireId,message_id:randomUUID(),action,data}),e=>e?reject(Error("send")):resolve())),signal);};
  const cancel=()=>fail("tencent_tts_cancelled");signal.addEventListener("abort",cancel,{once:true});
  try{
    check();ws=(options.socketFactory??((u,o)=>new WebSocket(u,o)))(url,{handshakeTimeout:options.timeoutMs,maxPayload:262144,perMessageDeflate:false,followRedirects:false});
    ws.on("error",()=>fail("tencent_tts_transport_failed"));ws.on("close",()=>{if(!finished)fail("tencent_tts_incomplete");});
    ws.on("message",(data,isBinary)=>{
      if(failure)return;
      try{
        const bytes=Array.isArray(data)?Buffer.concat(data):Buffer.from(data as Uint8Array);
        if(bytes.length>262144)throw Error();
        if(isBinary){
          if(!ready||!submitted||finished||!bytes.length)throw Error();queuedBytes+=bytes.length;totalBytes+=bytes.length;
          if(queuedBytes>rate*2*10||totalBytes>rate*2*120||queue.length>=256)throw Error();queue.push(bytes);
        }else{
          const e=JSON.parse(bytes.toString());
          if(!e||Array.isArray(e)||!Number.isInteger(e.code)||e.session_id!==wireId||!key(e.request_id)||!key(e.message_id)||
            seen.has(e.message_id)||seen.size>=4096||![0,1].includes(e.final)||![0,1].includes(e.ready??0)||![0,1].includes(e.heartbeat??0)||
            (e.ready??0)+(e.heartbeat??0)+e.final>1||requestId&&requestId!==e.request_id||finished)throw Error();
          requestId=e.request_id;seen.add(e.message_id);
          if(e.code!==0){fail("tencent_tts_provider_error");return;}
          if(e.ready===1){if(ready||submitted)throw Error();ready=true;}
          if(e.final===1){if(!completing||!submitted||totalBytes<2||totalBytes%2)throw Error();finished=true;metadata.requestId=requestId;}
        }
        wake();
      }catch{fail("tencent_tts_protocol_failed");}
    });
    await wait(()=>ready);check();submitted=true;markSent();await send("ACTION_SYNTHESIS",text);
    completing=true;await send("ACTION_COMPLETE","");
    while(!finished||queue.length){await wait(()=>queue.length>0||finished);while(queue.length){check();const bytes=queue.shift()!;queuedBytes-=bytes.length;yield bytes;}}
    check();
  }finally{signal.removeEventListener("abort",cancel);ws?.terminate();queue.length=0;}
}
