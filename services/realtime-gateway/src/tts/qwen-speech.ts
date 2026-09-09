import WebSocket from "ws";
import {randomUUID} from "node:crypto";
import type {PublicModelAttemptEvent} from "@translation/contracts";
import {PublicSpeechError,type PublicSpeechOptions} from "./public-speech.js";
import {abortable} from "../providers/abortable.js";

const languages:Record<string,string>={zh:"Chinese",en:"English",de:"German",it:"Italian",pt:"Portuguese",es:"Spanish",ja:"Japanese",ko:"Korean",fr:"French",ru:"Russian"};
export function qwenSpeechLanguage(language:string){
  if(!Object.hasOwn(languages,language))throw new PublicSpeechError("qwen_tts_language_not_supported","not_sent");
  return languages[language];
}
const key=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(v);
function usage(value:unknown):NonNullable<NonNullable<PublicModelAttemptEvent["metadata"]>["usage"]>|undefined {
  if(value===undefined)return;
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("usage");
  const v=value as Record<string,any>,result:Record<string,number>={};
  for(const details of [v.input_tokens_details,v.output_tokens_details])if(details!==undefined&&(!details||typeof details!=="object"||Array.isArray(details)))throw Error("usage");
  for(const [field,n]of Object.entries({billedCharacters:v.characters,totalTokens:v.total_tokens,promptTokens:v.input_tokens,
    completionTokens:v.output_tokens,textInputTokens:v.input_tokens_details?.text_tokens,audioOutputTokens:v.output_tokens_details?.audio_tokens})){
    if(n===undefined)continue;if(!Number.isSafeInteger(n)||n<0)throw Error("usage");result[field]=n;
  }
  return Object.keys(result).length?result:undefined;
}

/** One text segment per socket. Only wire state; the original synthesizer owns
 * timeout/cancellation, bounded PCM framing, deduplication and durable attempts. */
export async function* qwenSpeechPcm(options:PublicSpeechOptions,text:string,token:string,signal:AbortSignal,
  markSent:()=>void,metadata:NonNullable<PublicModelAttemptEvent["metadata"]>):AsyncIterable<Buffer> {
  const url=new URL(options.endpoint);url.searchParams.set("model",options.modelId);
  const expected={voice:options.voice,mode:"commit",language_type:qwenSpeechLanguage(options.targetLanguage),response_format:"pcm",sample_rate:24000};
  let ws:WebSocket|undefined,failure:PublicSpeechError|undefined,wake=()=>{},setup=false,submitted=false,committed=false,
    audioDone=false,completed=false,finishing=false,finished=false,sessionId:string|undefined,responseId:string|undefined,itemId:string|undefined;
  const queue:Buffer[]=[],seen=new Set<string>();let queuedBytes=0,totalBytes=0;
  const fail=(code:string)=>{if(failure)return;failure=new PublicSpeechError(code,submitted?"uncertain":"not_sent");wake();ws?.terminate();};
  const check=()=>{if(signal.aborted)fail("qwen_tts_cancelled");if(failure)throw failure;};
  const wait=async(predicate:()=>boolean)=>{while(!predicate()){check();await new Promise<void>(r=>wake=r);}check();};
  const send=async(event:Record<string,unknown>)=>{check();if(ws?.readyState!==WebSocket.OPEN||ws.bufferedAmount>1048576)throw new PublicSpeechError("qwen_tts_backpressure",submitted?"uncertain":"not_sent");
    await abortable(new Promise<void>((resolve,reject)=>ws!.send(JSON.stringify({event_id:randomUUID(),...event}),error=>error?reject(Error("send")):resolve())),signal);};
  const cancel=()=>fail("qwen_tts_cancelled");signal.addEventListener("abort",cancel,{once:true});
  try {
    check();ws=(options.socketFactory??((u,o)=>new WebSocket(u,o)))(url.toString(),{headers:{Authorization:`Bearer ${token}`},
      handshakeTimeout:options.timeoutMs,maxPayload:262144,perMessageDeflate:false,followRedirects:false});
    ws.on("error",()=>fail("qwen_tts_transport_failed"));ws.on("close",()=>{if(!finished)fail("qwen_tts_incomplete");});
    ws.on("message",(data,isBinary)=>{
      if(failure)return;
      try {
        if(isBinary||Buffer.byteLength(data.toString())>262144)throw Error();
        const e=JSON.parse(data.toString());if(!e||typeof e!=="object"||Array.isArray(e)||!key(e.event_id)||seen.has(e.event_id)||seen.size>=4096)throw Error();
        seen.add(e.event_id);
        if(e.type==="error"){fail("qwen_tts_provider_error");return;}
        if(e.type==="session.created"){
          if(sessionId||setup||!key(e.session?.id)||e.session.model!==options.modelId)throw Error();sessionId=e.session.id;
        }else if(e.type==="session.updated"){
          if(setup||!key(e.session?.id)||sessionId&&sessionId!==e.session.id||e.session.model!==options.modelId||
            Object.entries(expected).some(([k,v])=>e.session[k]!==v))throw Error();sessionId=e.session.id;setup=true;
        }else if(e.type==="input_text_buffer.committed"){
          if(!submitted||committed||typeof e.item_id!=="string")throw Error();committed=true;
        }else if(e.type==="response.created"){
          if(!committed||responseId||!key(e.response?.id)||e.response.status!=="in_progress"||e.response.voice!==options.voice)throw Error();responseId=e.response.id;
        }else if(e.type==="response.output_item.added"){
          if(!responseId||itemId||e.response_id!==responseId||e.output_index!==0||!key(e.item?.id)||e.item.role!=="assistant")throw Error();itemId=e.item.id;
        }else if(["response.content_part.added","response.content_part.done","response.audio.delta","response.audio.done"].includes(e.type)){
          if(!itemId||e.item_id!==itemId||e.response_id!==responseId||e.output_index!==0||e.content_index!==0||completed)throw Error();
          if(e.type==="response.audio.delta"){
            if(audioDone||typeof e.delta!=="string")throw Error();const bytes=Buffer.from(e.delta,"base64");
            if(!bytes.length||bytes.length%2||bytes.toString("base64")!==e.delta)throw Error();totalBytes+=bytes.length;queuedBytes+=bytes.length;
            if(totalBytes>5760000||queuedBytes>480000||queue.length>=256)throw Error();queue.push(bytes);
          }else if(e.type==="response.audio.done"){if(audioDone)throw Error();audioDone=true;}
          else if(e.part?.type!=="audio")throw Error();
        }else if(e.type==="response.output_item.done"){
          if(!itemId||completed||e.response_id!==responseId||e.output_index!==0||e.item?.id!==itemId||e.item.status!=="completed")throw Error();
        }else if(e.type==="response.done"){
          const r=e.response;
          if(completed||!audioDone||!totalBytes||r?.id!==responseId||r.status!=="completed"||r.voice!==options.voice||
            e.response_id!==undefined&&e.response_id!==responseId||!Array.isArray(r.output)||r.output.length!==1||r.output[0].id!==itemId||
            r.output[0].status!=="completed"||r.output[0].role!=="assistant"||r.output[0].content?.length!==1||r.output[0].content[0].type!=="audio")throw Error();
          metadata.requestId=responseId;metadata.reportedModel=options.modelId;const u=usage(r.usage);if(u)metadata.usage=u;completed=true;
        }else if(e.type==="session.finished"){
          if(!finishing||!completed||finished)throw Error();finished=true;
        }else throw Error();
        wake();
      }catch{fail("qwen_tts_protocol_failed");}
    });
    ws.once("open",()=>{void send({type:"session.update",session:expected}).catch(()=>fail("qwen_tts_setup_failed"));});
    await wait(()=>setup);check();submitted=true;markSent();
    await send({type:"input_text_buffer.append",text});await send({type:"input_text_buffer.commit"});
    while(!completed||queue.length){await wait(()=>queue.length>0||completed);while(queue.length){check();const bytes=queue.shift()!;queuedBytes-=bytes.length;yield bytes;}}
    check();finishing=true;await send({type:"session.finish"});await wait(()=>finished);
  }finally{signal.removeEventListener("abort",cancel);if(ws){ws.terminate();}queue.length=0;}
}
