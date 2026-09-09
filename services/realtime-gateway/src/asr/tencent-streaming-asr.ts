import WebSocket from "ws";
import {createHmac,randomBytes,randomInt} from "node:crypto";
import {PublicAsrError} from "./public-asr-completed-audio.js";
import {abortable} from "../providers/abortable.js";
import type {StreamingAsrOptions} from "./openai-streaming-asr-client.js";
const engines:Record<string,string>={"16k_zh":"zh","16k_zh_large":"zh","16k_yue":"yue","16k_zh-TW":"zh-Hant","16k_en":"en","16k_ar":"ar","16k_ko":"ko","16k_ja":"ja","16k_th":"th","16k_id":"id","16k_ms":"ms"};
export function validateTencentAsr(options:Pick<StreamingAsrOptions,"endpoint"|"appId"|"model"|"language">){
  const url=new URL(options.endpoint);
  if(!options.appId||!/^[1-9][0-9]{0,15}$/.test(options.appId)||!Number.isSafeInteger(Number(options.appId))||url.protocol!=="wss:"||
    url.pathname!==`/asr/v2/${options.appId}`||url.username||url.password||url.search||url.hash||!Object.hasOwn(engines,options.model)||engines[options.model]!==options.language)throw new PublicAsrError("tencent_asr_configuration","not_sent");
}
export function tencentAsrUrl(options:StreamingAsrOptions,credentials:{secretId?:string;secretKey?:string},voiceId:string,now=Date.now(),nonce=randomInt(1,10000000000)){
  validateTencentAsr(options);
  if(!credentials.secretId||!/^[A-Za-z0-9_-]{1,240}$/.test(credentials.secretId)||typeof credentials.secretKey!=="string"||!credentials.secretKey||credentials.secretKey.length>4096||
    credentials.secretKey.trim()!==credentials.secretKey||/[\u0000-\u001f\u007f]/.test(credentials.secretKey)||!/^[a-f0-9]{16}$/.test(voiceId)||
    !Number.isFinite(now)||now<0||!Number.isSafeInteger(nonce)||nonce<1||nonce>=10000000000)throw new PublicAsrError("tencent_asr_credentials","not_sent");
  const url=new URL(options.endpoint),timestamp=Math.floor(now/1000),params:Record<string,string>={engine_model_type:options.model,expired:String(timestamp+Math.ceil(options.timeoutMs/1000)+60),
    filter_dirty:"0",filter_modal:"0",filter_punc:"0",filter_empty_result:"0",needvad:"0",nonce:String(nonce),secretid:credentials.secretId,timestamp:String(timestamp),voice_format:"1",voice_id:voiceId};
  const entries=Object.entries(params).sort(([a],[b])=>a<b?-1:a>b?1:0),query=entries.map(([k,v])=>`${k}=${v}`).join("&");
  // ASR signs host/path, unlike Tencent TTS's GET-prefixed signing string.
  const signature=createHmac("sha1",credentials.secretKey).update(`${url.host}${url.pathname}?${query}`).digest("base64");
  url.search=entries.map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")+`&signature=${encodeURIComponent(signature)}`;return url.toString();
}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});void promise.catch(()=>{});return {promise,resolve,reject};}

/** One Tencent audio stream, not a second business Provider or billing lifecycle.
 * Shared ASR client owns trusted ranges/attempts and creates a fresh wire per turn. */
export class TencentAsrWire {
  private ws?:WebSocket;private readonly ready=deferred<void>();private readonly complete=deferred<{text:string;metadata:{requestId:string}}>();
  private readonly voiceId=randomBytes(8).toString("hex");private acknowledged=false;private ended=false;private finished=false;private sent=false;
  private failure?:PublicAsrError;private finalText?:string;private hadDraft=false;private readonly messages=new Set<string>();private nextSendAt=0;
  constructor(private readonly options:StreamingAsrOptions,private readonly signal:AbortSignal,private readonly partial:(text:string)=>void,private readonly onFailure:()=>void){}
  private cancel=()=>this.fail("tencent_asr_cancelled");
  async open(credentials:{secretId?:string;secretKey?:string}){
    const url=tencentAsrUrl(this.options,credentials,this.voiceId);this.signal.addEventListener("abort",this.cancel,{once:true});this.check();
    this.ws=(this.options.socketFactory??((u,o)=>new WebSocket(u,o)))(url,{handshakeTimeout:this.options.timeoutMs,maxPayload:262144,perMessageDeflate:false,followRedirects:false});
    this.ws.on("error",()=>this.fail("tencent_asr_transport"));this.ws.on("close",()=>{if(!this.finished)this.fail("tencent_asr_incomplete");});
    this.ws.on("message",(data,binary)=>{if(this.failure)return;try{if(binary||Buffer.byteLength(data.toString())>262144)throw Error();this.receive(JSON.parse(data.toString()));}catch{this.fail("tencent_asr_protocol");}});
    await abortable(this.ready.promise,this.signal);this.check();
  }
  async append(pcm:Buffer,markSent:()=>void){
    if(this.ended||this.finalText!==undefined)throw new PublicAsrError("tencent_asr_turn_closed","not_sent");
    for(let offset=0;offset<pcm.length;offset+=1280){
      this.check();const delay=Math.max(0,this.nextSendAt-performance.now());
      if(delay>0){let timer:ReturnType<typeof setTimeout>|undefined;try{await abortable(new Promise<void>(r=>timer=setTimeout(r,delay)),this.signal);}finally{clearTimeout(timer);}}
      this.check();const chunk=pcm.subarray(offset,offset+1280);markSent();this.sent=true;
      await this.send(chunk);this.nextSendAt=performance.now()+chunk.length/32;
    }
  }
  async finish(){
    this.check();if(!this.ended){this.ended=true;await this.send(JSON.stringify({type:"end"}));}
    const result=await abortable(this.complete.promise,this.signal);this.check();return result;
  }
  close(){this.signal.removeEventListener("abort",this.cancel);this.finished=true;this.ws?.terminate();}
  private check(){if(this.signal.aborted)this.fail("tencent_asr_cancelled");if(this.failure)throw this.failure;}
  private async send(data:Buffer|string){this.check();if(this.ws?.readyState!==WebSocket.OPEN||this.ws.bufferedAmount>1048576)throw Error("backpressure");
    await abortable(new Promise<void>((resolve,reject)=>this.ws!.send(data,e=>e?reject(Error("send")):resolve())),this.signal);}
  private fail(code:string){if(this.failure)return;this.failure=new PublicAsrError(code,this.sent?"uncertain":"not_sent");this.ready.reject(this.failure);this.complete.reject(this.failure);this.ws?.terminate();this.onFailure();}
  private receive(e:Record<string,any>){
    if(!e||typeof e!=="object"||Array.isArray(e)||!Number.isInteger(e.code)||e.voice_id!==this.voiceId||e.code!==0)throw Error();
    if(!this.acknowledged){if(e.result||e.final===1)throw Error();this.acknowledged=true;this.ready.resolve();return;}
    if(typeof e.message_id!=="string"||!e.message_id||e.message_id.length>240||this.messages.has(e.message_id)||this.messages.size>=4096||this.finished)throw Error();this.messages.add(e.message_id);
    if(e.result){
      const r=e.result;if(!this.sent||r.index!==0||![0,1,2].includes(r.slice_type)||typeof r.voice_text_str!=="string"||r.voice_text_str.length>16000||
        !Number.isSafeInteger(r.start_time)||!Number.isSafeInteger(r.end_time)||r.start_time<0||r.end_time<r.start_time||r.end_time>30000||this.finalText!==undefined)throw Error();
      if(r.slice_type===2)this.finalText=r.voice_text_str;else{this.hadDraft||=r.voice_text_str.length>0;this.partial(r.voice_text_str);}
    }
    if(e.final===1){if(!this.ended||!this.sent||this.hadDraft&&this.finalText===undefined)throw Error();this.finished=true;this.complete.resolve({text:this.finalText??"",metadata:{requestId:this.voiceId}});}
    else if(e.final!==undefined&&e.final!==0)throw Error();
  }
}
