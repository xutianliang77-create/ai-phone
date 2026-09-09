import WebSocket from "ws";
import {randomUUID} from "node:crypto";
import type {PublicModelAttemptEvent,TranslationLanguageCode} from "@translation/contracts";
import type {AsrSession,TranscriptResult} from "./asr-provider.js";
import type {HttpAsrRequest,HttpAsrFlushRequest,HttpAsrBoundaryRequest} from "./http-asr-client.js";
import {PublicAsrError,parseOpenAiAsr} from "./public-asr-completed-audio.js";
import {abortable} from "../providers/abortable.js";
import {cleanRealtimeText} from "../protocol/realtime-text.js";
import {qwenAsrSessionConfiguration,assertQwenAsrConfiguration} from "./qwen-streaming-asr-protocol.js";
import {TencentAsrWire} from "./tencent-streaming-asr.js";
import {GoogleAsrWire,type GoogleAsrStreamFactory} from "./google-streaming-asr.js";
type Result=ReturnType<typeof parseOpenAiAsr>;
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j;});void promise.catch(()=>{});return {promise,resolve,reject};}
type Turn={event:PublicModelAttemptEvent;prepared:boolean;sent:boolean;terminal:boolean;committing:boolean;ack:boolean;itemId?:string;previousItem?:string;
  partial:string;confirmedPrefix?:string;result?:Result;done:ReturnType<typeof deferred<Result>>;finalizing?:Promise<void>};
type State={ws?:WebSocket;stop:AbortController;ready:ReturnType<typeof deferred<void>>;configured:boolean;failure?:PublicAsrError;cursor:number;sequence:number;
  turn?:Turn;lastItem?:string;seen:Set<string>;busy:boolean;removeAbort:()=>void;wireSessionId?:string;wireEvents?:Set<string>;tencentWire?:TencentAsrWire|GoogleAsrWire};
export interface StreamingAsrOptions {sessionId:string;leaseId:string;endpoint:string;model:string;language:TranslationLanguageCode;timeoutMs:number;
  wireProfile?:"openai_realtime_asr"|"qwen_asr_realtime"|"tencent_asr_ws"|"google_speech_v2";appId?:string;
  projectId?:string;location?:string;recognizer?:string;languageLocales?:Record<string,string>;sampleRate?:16000|24000;googleStreamFactory?:GoogleAsrStreamFactory;
  authorizeConnection:()=>Promise<void>;resolveCredentials:(signal?:AbortSignal)=>Promise<{apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string}>|{apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string};
  record:(event:PublicModelAttemptEvent)=>Promise<void>;socketFactory?:(url:string,options:WebSocket.ClientOptions)=>WebSocket;}

/** Wire transport injected into the ORIGINAL HttpAsrProvider, not another realtime
 * business controller. One bound session; no reconnect, resampling or auto-commit. */
export class OpenAiStreamingAsrClient {
  // Historical public export retained; the same lifecycle supports explicit wire profiles.
  private get qwen(){return this.options.wireProfile==="qwen_asr_realtime";}
  private get tencent(){return this.options.wireProfile==="tencent_asr_ws";}
  private get google(){return this.options.wireProfile==="google_speech_v2";}
  private get perTurn(){return this.tencent||this.google;}
  private get rate():16000|24000{return this.google?this.options.sampleRate!:this.qwen||this.tencent?16000:24000;}
  private state?:State;
  private partialListener?: (result:TranscriptResult)=>void;
  private readonly options:StreamingAsrOptions;
  constructor(options:StreamingAsrOptions){this.options={...options};}
  setPartialListener(sessionId:string,listener:(result:TranscriptResult)=>void){
    if(sessionId!==this.options.sessionId)throw new PublicAsrError("public_asr_stream_scope","not_sent");this.partialListener=listener;
    return ()=>{if(this.partialListener===listener)this.partialListener=undefined;};
  }
  async createSession(session:AsrSession,signal:AbortSignal){
    if(session.sessionId!==this.options.sessionId||session.sourceLanguage!==this.options.language)throw new PublicAsrError("public_asr_stream_scope","not_sent");
    if(session.asrHotwords?.length||session.asrCorrections?.length)throw new PublicAsrError("public_asr_stream_hints_not_implemented","not_sent");
    await this.closeSession(session.sessionId);
    const s:State={stop:new AbortController(),ready:deferred<void>(),configured:false,cursor:0,sequence:-1,seen:new Set(),busy:false,removeAbort:()=>{}};this.state=s;
    const cancel=()=>this.fail(s,"public_asr_stream_closed");signal.addEventListener("abort",cancel,{once:true});s.removeAbort=()=>signal.removeEventListener("abort",cancel);
    if(signal.aborted)cancel();
    const timer=setTimeout(()=>this.fail(s,"public_asr_stream_setup_timeout"),this.options.timeoutMs);
    try{
      await abortable(this.options.authorizeConnection(),s.stop.signal);this.assert(s);
      // Tencent closes each stream at an endpoint. Prepare lazily on first PCM,
      // avoiding an idle signed socket while the user has not started speaking.
      if(this.perTurn){s.configured=true;s.ready.resolve();return;}
      const credentials=await abortable(Promise.resolve(this.options.resolveCredentials(s.stop.signal)),s.stop.signal);this.assert(s);
      if(typeof credentials.apiKey!=="string"||!credentials.apiKey.trim()||credentials.apiKey.trim()!==credentials.apiKey||/[\r\n]/.test(credentials.apiKey))throw Error("credential");
      const url=new URL(this.options.endpoint);url.searchParams.set("model",this.options.model);
      s.ws=(this.options.socketFactory??((url,opts)=>new WebSocket(url,opts)))(url.toString(),{headers:{Authorization:`Bearer ${credentials.apiKey}`},
        handshakeTimeout:this.options.timeoutMs,maxPayload:262144,perMessageDeflate:false,followRedirects:false});
      s.ws.on("error",()=>this.fail(s,"public_asr_stream_transport"));s.ws.on("close",()=>this.fail(s,"public_asr_stream_closed"));
      s.ws.on("message",(data,isBinary)=>{if(this.state!==s||s.failure)return;try{if(isBinary||Buffer.byteLength(data.toString())>262144)throw Error();this.receive(s,JSON.parse(data.toString()));}catch{this.fail(s,"public_asr_stream_protocol");}});
      s.ws.once("open",()=>{void this.send(s,{type:"session.update",session:this.qwen?qwenAsrSessionConfiguration(this.options.language):{type:"transcription",audio:{input:{format:{type:"audio/pcm",rate:24000},
        transcription:this.transcription(),turn_detection:null}}}}).catch(()=>this.fail(s,"public_asr_stream_setup"));});
      await abortable(s.ready.promise,s.stop.signal);this.assert(s);
    }catch{this.fail(s,"public_asr_stream_setup");s.removeAbort();if(this.state===s)this.state=undefined;throw s.failure!;}finally{clearTimeout(timer);}
  }
  private transcription(){return {model:this.options.model,...(this.options.model.startsWith("gpt-live-transcribe")?{languages:[this.options.language]}:{language:this.options.language})};}
  async transcribe(request:HttpAsrRequest,signal?:AbortSignal):Promise<TranscriptResult|null>{
    const s=this.current(request.sessionId);if(s.busy)throw new PublicAsrError("public_asr_stream_busy","not_sent");
    const pcm=Buffer.from(request.data,"base64");
    if(request.sourceLanguage!==this.options.language||request.format!=="pcm16"||request.sampleRate!==this.rate||!pcm.length||pcm.length%2||pcm.length>this.rate*60||
      pcm.toString("base64")!==request.data||!Number.isSafeInteger(request.sequence)||request.sequence<=s.sequence||
      !Number.isFinite(request.timestampMs)||request.timestampMs<0||!request.acceptedAudioRange||request.acceptedAudioRange.startSample!==s.cursor||
      request.acceptedAudioRange.endSample!==s.cursor+pcm.length/2||
      s.turn?.committing||(s.turn?.event.audioEndSample??s.cursor)-(s.turn?.event.audioStartSample??s.cursor)+pcm.length/2>this.rate*30){
      this.fail(s,"public_asr_stream_audio_invalid");throw s.failure!;
    }
    s.busy=true;const cancelled=()=>this.fail(s,"public_asr_stream_cancelled");signal?.addEventListener("abort",cancelled,{once:true});
    const timer=setTimeout(()=>this.fail(s,"public_asr_stream_append_timeout"),this.options.timeoutMs);
    try{
      if(signal?.aborted)throw Error("aborted");
      const end=s.cursor+pcm.length/2;
      const turn=s.turn??{event:{sessionId:this.options.sessionId,leaseId:this.options.leaseId,attemptId:randomUUID(),segmentId:randomUUID(),revision:1,
        component:"asr",providerId:this.qwen?"qwen":this.tencent?"tencent":this.google?"google":"openai",modelId:this.options.model,state:"dispatching",audioStartSample:s.cursor,audioEndSample:end,audioSampleRate:this.rate},
        prepared:false,sent:false,terminal:false,committing:false,ack:false,partial:"",done:deferred<Result>()} satisfies Turn;
      s.turn=turn;turn.event={...turn.event,audioEndSample:end};
      await abortable(this.record(turn.event),s.stop.signal);turn.prepared=true;this.assert(s);
      if(signal?.aborted)throw Error("aborted");
      if(this.perTurn){
        if(!s.tencentWire){
          await abortable(this.options.authorizeConnection(),s.stop.signal);this.assert(s);
          const credentials=await abortable(Promise.resolve(this.options.resolveCredentials(s.stop.signal)),s.stop.signal);this.assert(s);
          const Wire=this.google?GoogleAsrWire:TencentAsrWire;
          const wire=new Wire(this.options,s.stop.signal,text=>{if(this.state===s&&!s.failure&&s.turn===turn){
            turn.partial=text;const clean=cleanRealtimeText(text);if(clean)this.partialListener?.({segmentId:turn.event.segmentId,revision:0,isFinal:false,text:clean,language:this.options.language});}},()=>this.fail(s,"public_asr_stream_transport"));
          s.tencentWire=wire;await wire.open(credentials);this.assert(s);
        }
        await s.tencentWire.append(pcm,()=>{turn.sent=true;});this.assert(s);
      }else{
      // Original batcher force-drain may merge several seconds. Split wire writes,
      // never semantic turns; the full range is already durably reserved above.
      for(let offset=0;offset<pcm.length;offset+=this.rate*2){turn.sent=true;
        await this.send(s,{type:"input_audio_buffer.append",audio:pcm.subarray(offset,offset+this.rate*2).toString("base64")});this.assert(s);}
      }
      s.cursor=end;s.sequence=request.sequence;return null;
    }catch{this.fail(s,"public_asr_stream_append_failed");await this.finish(s.turn);throw s.failure!;}finally{s.busy=false;clearTimeout(timer);signal?.removeEventListener("abort",cancelled);}
  }
  async flush(request:HttpAsrFlushRequest,signal?:AbortSignal):Promise<TranscriptResult|null>{
    const s=this.current(request.sessionId);if(s.busy)throw new PublicAsrError("public_asr_stream_busy","not_sent");const turn=s.turn;if(!turn)return null;
    if(turn.event.audioEndSample!-turn.event.audioStartSample!<this.rate/10){this.fail(s,"public_asr_stream_turn_too_short");await this.finish(turn);throw s.failure!;}
    s.busy=true;const cancelled=()=>this.fail(s,"public_asr_stream_cancelled");signal?.addEventListener("abort",cancelled,{once:true});
    const timer=setTimeout(()=>this.fail(s,"public_asr_stream_commit_timeout"),this.options.timeoutMs);
    try{
      if(signal?.aborted)throw Error();
      // Re-check revocation and runtime BEFORE the explicit inference commit.
      await abortable(this.record(turn.event),s.stop.signal);this.assert(s);
      if(signal?.aborted)throw Error();
      turn.committing=true;turn.previousItem=s.lastItem;let result:Result;
      if(this.perTurn){if(!s.tencentWire)throw Error();result=await s.tencentWire.finish();turn.itemId=result.metadata.requestId??turn.event.attemptId;}
      else{await this.send(s,{type:"input_audio_buffer.commit"});result=await abortable(turn.done.promise,s.stop.signal);}
      this.assert(s);
      turn.terminal=true;turn.finalizing=this.record({...turn.event,state:"confirmed",metadata:result.metadata});await turn.finalizing;this.assert(s);
      s.seen.add(turn.itemId!);if(s.seen.size>1024)throw Error();s.turn=undefined;
      if(this.perTurn){s.tencentWire?.close();s.tencentWire=undefined;}
      return result.text?{segmentId:turn.event.segmentId,revision:1,isFinal:true,text:result.text,language:this.options.language,
        timing:{startMs:turn.event.audioStartSample!/(this.rate/1000),endMs:turn.event.audioEndSample!/(this.rate/1000),source:"estimated"}}:null;
    }catch{this.fail(s,"public_asr_stream_commit_failed");try{await this.finish(turn);}catch{}throw s.failure!;}finally{s.busy=false;clearTimeout(timer);signal?.removeEventListener("abort",cancelled);}
  }
  async commitBoundary(request:HttpAsrBoundaryRequest,signal?:AbortSignal){
    const s=this.current(request.sessionId);if(!Number.isFinite(request.boundaryMs)||Math.abs(request.boundaryMs-s.cursor/(this.rate/1000))>1)throw new PublicAsrError("public_asr_stream_boundary_mismatch","not_sent");
    return this.flush(request,signal);
  }
  async closeSession(sessionId:string){const s=this.state;if(!s||sessionId!==this.options.sessionId)return;this.partialListener=undefined;this.fail(s,"public_asr_stream_closed");await this.finish(s.turn);s.removeAbort();if(this.state===s)this.state=undefined;}
  async diagnostics():Promise<never>{throw new Error("public_asr_stream_diagnostics_not_qualified");}
  async healthCheck(){return false;}
  private current(id:string){if(id!==this.options.sessionId||!this.state)throw new PublicAsrError("public_asr_stream_scope","not_sent");this.assert(this.state);
    if(!this.state.configured)throw new PublicAsrError("public_asr_stream_not_ready","not_sent");return this.state;}
  private assert(s:State){if(this.state!==s||s.failure||s.stop.signal.aborted)throw s.failure??new PublicAsrError("public_asr_stream_closed","uncertain");}
  private async record(event:PublicModelAttemptEvent){const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);try{await abortable(this.options.record(structuredClone(event)),c.signal);}finally{clearTimeout(t);}}
  private async finish(turn?:Turn){if(turn?.finalizing)return turn.finalizing;if(!turn?.prepared||turn.terminal)return;turn.terminal=true;
    turn.finalizing=this.record({...turn.event,state:turn.sent?"uncertain":"not_sent",failureCode:"public_asr_stream_interrupted"}).catch(()=>{/* durable intent remains unresolved */});return turn.finalizing;}
  private fail(s:State,code:string){if(s.failure)return;s.failure=new PublicAsrError(code,s.turn?.sent?"uncertain":"not_sent");s.stop.abort();s.ready.reject(s.failure);s.turn?.done.reject(s.failure);s.ws?.terminate();s.tencentWire?.close();void this.finish(s.turn).catch(()=>{});}
  private async send(s:State,event:unknown){this.assert(s);if(s.ws?.readyState!==WebSocket.OPEN||s.ws.bufferedAmount>1048576)throw Error("socket not writable");
    await abortable(new Promise<void>((resolve,reject)=>s.ws!.send(JSON.stringify(this.qwen?{...(event as object),event_id:randomUUID()}:event),error=>error?reject(Error("send failed")):resolve())),s.stop.signal);}
  private receive(s:State,e:Record<string,any>){
    if(!e||typeof e!=="object"||Array.isArray(e)||typeof e.type!=="string")throw Error();
    if(this.qwen){
      // Failure events may omit event_id in the documented payload. No provider
      // error body is forwarded. Other messages must have bounded unique IDs.
      if(e.type==="error"||e.type==="conversation.item.input_audio_transcription.failed")throw Error();
      if(typeof e.event_id!=="string"||!e.event_id||e.event_id.length>240)throw Error();
      s.wireEvents??=new Set();if(s.wireEvents.has(e.event_id)||s.wireEvents.size>=16384)throw Error();s.wireEvents.add(e.event_id);
      if(e.type==="session.created"){
        if(s.wireSessionId||typeof e.session?.id!=="string"||!e.session.id||e.session.id.length>240||e.session.model!==this.options.model)throw Error();s.wireSessionId=e.session.id;return;
      }
      if(e.type==="session.updated"){
        if(s.configured)throw Error();assertQwenAsrConfiguration(e.session,this.options.model,this.options.language);
        if(s.wireSessionId&&s.wireSessionId!==e.session.id)throw Error();s.wireSessionId=e.session.id;s.configured=true;s.ready.resolve();return;
      }
      if(e.type==="conversation.item.created"){
        const turn=s.turn;if(!turn?.committing||!turn.itemId||e.item?.id!==turn.itemId||e.item.role!=="user"||e.item.type!=="message"||
          (e.previous_item_id||undefined)!==turn.previousItem||e.item.content?.length!==1||e.item.content[0].type!=="input_audio")throw Error();return;
      }
      if(e.type==="input_audio_buffer.committed")e={...e,previous_item_id:e.previous_item_id||undefined};
      else if(["conversation.item.input_audio_transcription.text","conversation.item.input_audio_transcription.completed"].includes(e.type)){
        if(e.language!==this.options.language)throw Error();
      }else throw Error();
    }
    if(e.type==="session.created")return;
    if(e.type==="session.updated"){
      const input=e.session?.audio?.input,transcription=input?.transcription,expected=this.transcription();
      if(e.session?.type!=="transcription"||input?.format?.type!=="audio/pcm"||input.format.rate!==24000||input.turn_detection!==null||
        transcription?.model!==expected.model||("languages"in expected?JSON.stringify(transcription.languages)!==JSON.stringify(expected.languages):transcription.language!==expected.language))throw Error();
      s.configured=true;s.ready.resolve();return;
    }
    if(e.type==="error"||e.type==="conversation.item.input_audio_transcription.failed")throw Error();
    if(!["input_audio_buffer.committed","conversation.item.input_audio_transcription.delta","conversation.item.input_audio_transcription.completed"].includes(e.type)&&
      !(this.qwen&&e.type==="conversation.item.input_audio_transcription.text"))return;
    if(typeof e.item_id!=="string"||!e.item_id||e.item_id.length>240)throw Error();if(s.seen.has(e.item_id))return;
    const turn=s.turn;if(!turn?.sent||turn.terminal)throw Error();
    if(turn.itemId&&turn.itemId!==e.item_id)throw Error();turn.itemId=e.item_id;
    if(e.type==="input_audio_buffer.committed"){
      if(!turn.committing||(e.previous_item_id??undefined)!==turn.previousItem)throw Error();turn.ack=true;s.lastItem=e.item_id;
    }else{
      if(e.content_index!==0)throw Error();
      if(this.qwen&&e.type.endsWith(".text")){
        if(typeof e.text!=="string"||typeof e.stash!=="string"||e.text.length+e.stash.length>16000||!e.text.startsWith(turn.confirmedPrefix??""))throw Error();
        turn.confirmedPrefix=e.text;turn.partial=e.text+e.stash;
        const text=cleanRealtimeText(turn.partial);if(text)this.partialListener?.({segmentId:turn.event.segmentId,revision:0,isFinal:false,text,language:this.options.language});
      }else if(e.type.endsWith(".delta")){if(typeof e.delta!=="string"||turn.partial.length+e.delta.length>16000)throw Error();turn.partial+=e.delta;
        const text=cleanRealtimeText(turn.partial);if(text)this.partialListener?.({segmentId:turn.event.segmentId,revision:0,isFinal:false,text,language:this.options.language});}
      else {if(!turn.committing)throw Error();const result=parseOpenAiAsr({text:e.transcript,...(!this.qwen&&e.usage!==undefined?{usage:e.usage}:{})},e.item_id);
        if(turn.result&&JSON.stringify(turn.result)!==JSON.stringify(result))throw Error();turn.result=result;}
    }
    if(turn.ack&&turn.result)turn.done.resolve(turn.result);
  }
}
