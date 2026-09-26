import WebSocket from "ws";
import {randomUUID} from "node:crypto";
import type {LanguageCode,PublicModelAttemptEvent,TranslationLanguageCode,PublicAsrServerVad} from "@translation/contracts";
import type {AsrProviderResult,AsrSession,TranscriptResult} from "./asr-provider.js";
import type {HttpAsrRequest,HttpAsrFlushRequest,HttpAsrBoundaryRequest} from "./http-asr-client.js";
import {PublicAsrError,parseOpenAiAsr} from "./public-asr-completed-audio.js";
import {abortable} from "../providers/abortable.js";
import {cleanRealtimeText} from "../protocol/realtime-text.js";
import {qwenAsrSessionConfiguration,assertQwenAsrConfiguration,qwenTranscriptLanguage,qwenDraftTranscriptLanguage} from "./qwen-streaming-asr-protocol.js";
import {TencentAsrWire} from "./tencent-streaming-asr.js";
import {GoogleAsrWire,type GoogleAsrStreamFactory} from "./google-streaming-asr.js";
import {realtimeLogger} from "../metrics/realtime-metrics.js";
import {logPublicAsrBoundary} from "../metrics/public-asr-boundary-trace.js";
import {streamingAsrFailureDiagnostic,streamingAsrCancellationContext,streamingAsrCloseContext,streamingAsrTransportContext,
  isStreamingAsrFailureEvent,streamingAsrProviderContext,streamingAsrProtocolContext,type StreamingAsrFailureContext} from "./streaming-asr-diagnostics.js";
import {deferred,type State,type Turn,type Result} from "./streaming-asr-state.js";
import {sendStreamingAsrWireEvent,streamingAsrSendDiagnostic} from "./streaming-asr-wire-send.js";
import {completeQwenTurn} from "./qwen-streaming-asr-results.js";
const key=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(value);
export interface StreamingAsrOptions {sessionId:string;leaseId:string;endpoint:string;model:string;language:LanguageCode;timeoutMs:number;
  serverVad?:PublicAsrServerVad;
  wireProfile?:"openai_realtime_asr"|"qwen_asr_realtime"|"tencent_asr_ws"|"google_speech_v2";appId?:string;
  projectId?:string;location?:string;recognizer?:string;languageLocales?:Record<string,string>;sampleRate?:16000|24000;
  /** source=auto only: conservative fallback for unknown/mixed text,
   * not a substitute for provider or qualified text language evidence. */
  detectedLanguageFallback?:TranslationLanguageCode;
  /** The only provider-confirmed language scope accepted for source=auto. */
  automaticLanguagePair?:readonly [TranslationLanguageCode,TranslationLanguageCode];
  automaticSourceLanguages?:readonly TranslationLanguageCode[];
  googleStreamFactory?:GoogleAsrStreamFactory;
  authorizeConnection:()=>Promise<void>;resolveCredentials:(signal?:AbortSignal)=>Promise<{apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string}>|{apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string};
  record:(event:PublicModelAttemptEvent)=>Promise<void>;socketFactory?:(url:string,options:WebSocket.ClientOptions)=>WebSocket;}
/** Original HttpAsrProvider transport: one session, no new controller/reconnect/resampling.
 * The selected Qwen server VAD owns supplier commits. */
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
    const s:State={stop:new AbortController(),ready:deferred<void>(),configured:false,cursor:0,sequence:-1,seen:new Set(),busy:false,removeAbort:()=>{},
      pendingWireEvents:[],completed:[],finalization:Promise.resolve(),finishing:false,providerFinished:false,finished:deferred<void>()};this.state=s;
    const cancel=()=>{if(!s.providerFinished)this.fail(s,"public_asr_stream_closed",streamingAsrCancellationContext(signal));};signal.addEventListener("abort",cancel,{once:true});s.removeAbort=()=>signal.removeEventListener("abort",cancel);
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
      s.ws.on("error",error=>this.fail(s,"public_asr_stream_transport",streamingAsrTransportContext(error)));
      s.ws.on("close",(code,reason)=>{if(!s.providerFinished)this.fail(s,"public_asr_stream_closed",streamingAsrCloseContext(code,reason));});
      s.ws.on("message",(data,isBinary)=>{if(this.state!==s||s.failure)return;try{if(isBinary||Buffer.byteLength(data.toString())>262144)throw Error();
        const event=JSON.parse(data.toString());
        // Fatal/control events do not depend on a pending audio turn. Preserve
        // the first cause before a following socket close can hide it.
        if(isStreamingAsrFailureEvent(event)){s.lastWireType=event.type;this.fail(s,"public_asr_stream_provider_error",streamingAsrProviderContext(event));return;}
        if(this.qwen&&event?.type!=="session.finished"&&s.configured&&!s.finishing&&(s.busy||s.turn?.finalizing||!s.turn)){if(s.pendingWireEvents.length>=4096)throw Error();s.pendingWireEvents.push(event);}
        else this.receiveWireEvent(s,event);}catch{this.fail(s,"public_asr_stream_protocol",{origin:"protocol"});}});
      s.ws.once("open",()=>{void this.send(s,{type:"session.update",session:this.qwen?qwenAsrSessionConfiguration(this.options.language,this.options.serverVad):{type:"transcription",audio:{input:{format:{type:"audio/pcm",rate:24000},
        transcription:this.transcription(),turn_detection:null}}}}).catch(()=>this.fail(s,"public_asr_stream_setup"));});
      await abortable(s.ready.promise,s.stop.signal);this.assert(s);
    }catch{this.fail(s,"public_asr_stream_setup");s.removeAbort();if(this.state===s)this.state=undefined;throw s.failure!;}finally{clearTimeout(timer);}
  }
  private transcription(){
    if(this.options.language==="auto")return {model:this.options.model};
    return {model:this.options.model,...(this.options.model.startsWith("gpt-live-transcribe")?{languages:[this.options.language]}:{language:this.options.language})};
  }
  private transcriptLanguage(turn?:Turn):TranslationLanguageCode{
    return this.options.language==="auto"
      ? turn?.detectedLanguage??this.options.detectedLanguageFallback??"zh"
      : this.options.language;
  }
  async transcribe(request:HttpAsrRequest,signal?:AbortSignal):Promise<AsrProviderResult>{
    const s=this.current(request.sessionId);if(s.busy)throw new PublicAsrError("public_asr_stream_busy","not_sent");
    if(this.qwen)return this.transcribeQwenServerVad(s,request,signal);
    const pcm=Buffer.from(request.data,"base64");
    if(request.sourceLanguage!==this.options.language||request.format!=="pcm16"||request.sampleRate!==this.rate||!pcm.length||pcm.length%2||pcm.length>this.rate*60||
      pcm.toString("base64")!==request.data||!Number.isSafeInteger(request.sequence)||request.sequence<=s.sequence||
      !Number.isFinite(request.timestampMs)||request.timestampMs<0||!request.acceptedAudioRange||request.acceptedAudioRange.startSample!==s.cursor||
      request.acceptedAudioRange.endSample!==s.cursor+pcm.length/2||
      s.turn?.committing||(s.turn?.event.audioEndSample??s.cursor)-(s.turn?.event.audioStartSample??s.cursor)+pcm.length/2>this.rate*30){
      this.fail(s,"public_asr_stream_audio_invalid");throw s.failure!;
    }
    s.busy=true;const cancelled=()=>this.fail(s,"public_asr_stream_cancelled",streamingAsrCancellationContext(signal));signal?.addEventListener("abort",cancelled,{once:true});
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
            turn.partial=text;const clean=cleanRealtimeText(text);if(clean)this.partialListener?.({segmentId:turn.event.segmentId,revision:0,isFinal:false,text:clean,language:this.transcriptLanguage()});}},()=>this.fail(s,"public_asr_stream_transport"));
          s.tencentWire=wire;await wire.open(credentials);this.assert(s);
        }
        await s.tencentWire.append(pcm,()=>{turn.sent=true;});this.assert(s);
      }else{
      // Original batcher force-drain may merge several seconds. Split wire writes,
      // never semantic turns; the full range is already durably reserved above.
      for(let offset=0;offset<pcm.length;offset+=this.rate*2){turn.sent=true;
        await this.send(s,{type:"input_audio_buffer.append",audio:pcm.subarray(offset,offset+this.rate*2).toString("base64")});this.assert(s);}
      }
      s.cursor=end;s.sequence=request.sequence;
      return null;
    }catch{this.fail(s,"public_asr_stream_append_failed");await this.finish(s.turn);throw s.failure!;}finally{s.busy=false;clearTimeout(timer);signal?.removeEventListener("abort",cancelled);}
  }
  private async transcribeQwenServerVad(s:State,request:HttpAsrRequest,signal?:AbortSignal):Promise<AsrProviderResult>{
    this.drainQwenWireEvents(s);this.assert(s);
    const pcm=Buffer.from(request.data,"base64");
    if(request.sourceLanguage!==this.options.language||request.format!=="pcm16"||request.sampleRate!==this.rate||!pcm.length||pcm.length%2||pcm.length>this.rate*60||
      pcm.toString("base64")!==request.data||!Number.isSafeInteger(request.sequence)||request.sequence<=s.sequence||!Number.isFinite(request.timestampMs)||request.timestampMs<0||
      !request.acceptedAudioRange||request.acceptedAudioRange.startSample!==s.cursor||!Number.isSafeInteger(request.acceptedAudioRange.endSample)||
      request.acceptedAudioRange.endSample!==s.cursor+pcm.length/2){this.fail(s,"public_asr_stream_audio_invalid");throw s.failure!;}
    s.busy=true;const cancelled=()=>this.fail(s,"public_asr_stream_cancelled",streamingAsrCancellationContext(signal));signal?.addEventListener("abort",cancelled,{once:true});
    const timer=setTimeout(()=>this.fail(s,"public_asr_stream_append_timeout"),this.options.timeoutMs);
    try{
      if(signal?.aborted)throw Error("aborted");
      const start=s.cursor,end=start+pcm.length/2;
      const current=s.qwenTransport??{event:{sessionId:this.options.sessionId,leaseId:this.options.leaseId,attemptId:randomUUID(),segmentId:randomUUID(),revision:1,
        component:"asr" as const,providerId:"qwen",modelId:this.options.model,state:"dispatching" as const,audioStartSample:s.cursor,audioEndSample:end,audioSampleRate:this.rate},prepared:false,sent:false,terminal:false};
      s.qwenTransport=current;current.event={...current.event,audioEndSample:end};
      await abortable(this.record(current.event),s.stop.signal);current.prepared=true;this.assert(s);
      for(let offset=0;offset<pcm.length;offset+=this.rate*2){current.sent=true;await this.send(s,{type:"input_audio_buffer.append",audio:pcm.subarray(offset,offset+this.rate*2).toString("base64")});this.assert(s);}
      s.cursor=end;s.sequence=request.sequence;
      logPublicAsrBoundary({sessionId:this.options.sessionId,stage:"provider_audio",sequence:request.sequence,
        startSample:start,endSample:end,acceptedSamples:end});
      this.drainQwenWireEvents(s);this.assert(s);return this.takeCompleted(s);
    }catch{this.fail(s,"public_asr_stream_append_failed");await this.finishQwenTransport(s);throw s.failure!;}
    finally{s.busy=false;clearTimeout(timer);signal?.removeEventListener("abort",cancelled);}
  }
  async flush(request:HttpAsrFlushRequest,signal?:AbortSignal):Promise<AsrProviderResult>{
    const s=this.current(request.sessionId);if(s.busy)throw new PublicAsrError("public_asr_stream_busy","not_sent");
    if(this.qwen)return this.flushQwenServerVad(s,request.finishSession===true,signal);
    const turn=s.turn;if(!turn)return null;
    if(turn.event.audioEndSample!-turn.event.audioStartSample!<this.rate/10){this.fail(s,"public_asr_stream_turn_too_short");await this.finish(turn);throw s.failure!;}
    s.busy=true;const cancelled=()=>this.fail(s,"public_asr_stream_cancelled",streamingAsrCancellationContext(signal));signal?.addEventListener("abort",cancelled,{once:true});
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
      s.seen.add(turn.itemId!);if(s.seen.size>1024)s.seen.delete(s.seen.values().next().value!);s.turn=undefined;
      if(this.perTurn){s.tencentWire?.close();s.tencentWire=undefined;}
      return result.text?{segmentId:turn.event.segmentId,revision:1,isFinal:true,text:result.text,language:this.transcriptLanguage(turn),
        timing:{startMs:turn.event.audioStartSample!/(this.rate/1000),endMs:turn.event.audioEndSample!/(this.rate/1000),source:"estimated"}}:null;
    }catch{this.fail(s,"public_asr_stream_commit_failed");try{await this.finish(turn);}catch{}throw s.failure!;}finally{s.busy=false;clearTimeout(timer);signal?.removeEventListener("abort",cancelled);}
  }
  async commitBoundary(request:HttpAsrBoundaryRequest,signal?:AbortSignal){
    const s=this.current(request.sessionId);if(!Number.isFinite(request.boundaryMs)||Math.abs(request.boundaryMs-s.cursor/(this.rate/1000))>1)throw new PublicAsrError("public_asr_stream_boundary_mismatch","not_sent");
    return this.flush(request,signal);
  }
  private async flushQwenServerVad(s:State,finishSession:boolean,signal?:AbortSignal):Promise<AsrProviderResult>{
    this.drainQwenWireEvents(s);await abortable(s.finalization,s.stop.signal);this.assert(s);
    if(!finishSession)return this.takeCompleted(s);
    s.busy=true;const cancelled=()=>this.fail(s,"public_asr_stream_cancelled",streamingAsrCancellationContext(signal));signal?.addEventListener("abort",cancelled,{once:true});
    const timer=setTimeout(()=>this.fail(s,"public_asr_stream_finish_timeout"),this.options.timeoutMs);
    try{
      if(signal?.aborted)throw Error();
      if(!s.finishing){
        // The growing transport attempt was durably extended before every PCM
        // append. Do not rewrite it at stop: its range is immutable evidence.
        if(s.qwenTransport?.prepared)this.assert(s);
        s.finishing=true;await this.send(s,{type:"session.finish"});
      }
      await abortable(s.finished.promise,s.stop.signal);this.assert(s);
      this.drainQwenWireEvents(s);await abortable(s.finalization,s.stop.signal);this.assert(s);
      if(s.turn&&!s.turn.terminal){s.turn.terminal=true;s.turn=undefined;}
      await this.confirmQwenTransport(s);
      await abortable(s.finalization,s.stop.signal);this.assert(s);return this.takeCompleted(s);
    }catch{this.fail(s,"public_asr_stream_finish_failed");await this.finishQwenTransport(s);throw s.failure!;}
    finally{s.busy=false;clearTimeout(timer);signal?.removeEventListener("abort",cancelled);}
  }
  takeLanguageNotices(sessionId:string){return this.current(sessionId).languageNotices?.splice(0)??[];}
  private async confirmQwenTransport(s:State){
    const transport=s.qwenTransport;if(!transport||transport.finalizing||transport.terminal)return;
    transport.terminal=true;transport.finalizing=this.record({...transport.event,state:"confirmed",metadata:{}}).catch(()=>{
      this.fail(s,"public_asr_attempt_record_failed");throw s.failure!;
    });s.finalization=transport.finalizing;void s.finalization.catch(()=>{});await transport.finalizing;
  }
  private drainQwenWireEvents(s:State){while(s.pendingWireEvents.length){this.assert(s);this.receiveWireEvent(s,s.pendingWireEvents.shift()!);}}
  private receiveWireEvent(s:State,e:Record<string,any>){
    s.lastWireType=e?.type;s.lastWireLanguage=e?.language;
    try{this.receive(s,e);}catch(error){this.fail(s,error instanceof PublicAsrError?error.code:"public_asr_stream_protocol",streamingAsrProtocolContext(e));throw s.failure!;}
  }
  private takeCompleted(s:State):AsrProviderResult{const values=s.completed.splice(0);return values.length===0?null:values.length===1?values[0]:values;}
  async closeSession(sessionId:string){const s=this.state;if(!s||sessionId!==this.options.sessionId)return;this.partialListener=undefined;
    if(s.providerFinished){s.ws?.terminate();await s.finalization.catch(()=>{});}else{this.fail(s,"public_asr_stream_closed",{origin:"explicit_close"});await (this.qwen?this.finishQwenTransport(s):this.finish(s.turn));}
    s.removeAbort();if(this.state===s)this.state=undefined;}
  async diagnostics():Promise<never>{throw new Error("public_asr_stream_diagnostics_not_qualified");}
  async healthCheck(){return false;}
  private current(id:string){if(id!==this.options.sessionId||!this.state)throw new PublicAsrError("public_asr_stream_scope","not_sent");this.assert(this.state);
    if(!this.state.configured)throw new PublicAsrError("public_asr_stream_not_ready","not_sent");return this.state;}
  private assert(s:State){if(this.state!==s||s.failure||s.stop.signal.aborted)throw s.failure??new PublicAsrError("public_asr_stream_closed","uncertain");}
  private async record(event:PublicModelAttemptEvent){const c=new AbortController(),t=setTimeout(()=>c.abort(),5000);try{await abortable(this.options.record(structuredClone(event)),c.signal);}finally{clearTimeout(t);}}
  private async finish(turn?:Turn){if(turn?.finalizing)return turn.finalizing;if(!turn?.prepared||turn.terminal)return;turn.terminal=true;
    turn.finalizing=this.record({...turn.event,state:turn.sent?"uncertain":"not_sent",failureCode:"public_asr_stream_interrupted"}).catch(()=>{/* durable intent remains unresolved */});return turn.finalizing;}
  private async finishQwenTransport(s:State){
    const transport=s.qwenTransport;if(!transport?.prepared||transport.terminal)return transport?.finalizing;
    const failureCode=s.failure?.code??"public_asr_stream_interrupted";
    transport.terminal=true;transport.finalizing=this.record({...transport.event,state:transport.sent?"uncertain":"not_sent",failureCode}).catch(()=>{/* durable intent remains unresolved */});
    s.finalization=transport.finalizing;void s.finalization.catch(()=>{});return transport.finalizing;
  }
  private fail(s:State,code:string,context:StreamingAsrFailureContext={origin:"operation"}){if(s.failure)return;s.failure=new PublicAsrError(code,this.qwen?s.qwenTransport?.sent?"uncertain":"not_sent":s.turn?.sent?"uncertain":"not_sent");
    const attempt=this.qwen?s.qwenTransport:s.turn;
    if(attempt?.sent&&!attempt.terminal||context.origin!=="explicit_close"&&!s.providerFinished)realtimeLogger.warn({sessionId:this.options.sessionId,
      ...streamingAsrFailureDiagnostic(code,s.lastWireType,s.cursor,s.lastWireLanguage,context),...streamingAsrSendDiagnostic(s.audioSend),outcome:s.failure.outcome},"Public ASR stream failed");
    s.stop.abort();s.ready.reject(s.failure);s.finished.reject(s.failure);s.turn?.done.reject(s.failure);s.ws?.terminate();s.tencentWire?.close();void (this.qwen?this.finishQwenTransport(s):this.finish(s.turn)).catch(()=>{});}
  private async send(s:State,event:unknown){this.assert(s);await sendStreamingAsrWireEvent(s,event,this.qwen,this.rate);}
  private receive(s:State,e:Record<string,any>){
    if(!e||typeof e!=="object"||Array.isArray(e)||typeof e.type!=="string")throw Error();
    if(this.qwen){
      // Failure events may omit event_id; no error body is forwarded. Others need bounded unique IDs.
      if(e.type==="error"||e.type==="conversation.item.input_audio_transcription.failed")throw Error();
      if(typeof e.event_id!=="string"||!e.event_id||e.event_id.length>240)throw Error();
      s.wireEvents??=new Set();if(s.wireEvents.has(e.event_id))throw Error();s.wireEvents.add(e.event_id);
      if(s.wireEvents.size>4096)s.wireEvents.delete(s.wireEvents.values().next().value!);
      if(e.type==="session.created"){
        if(s.wireSessionId||typeof e.session?.id!=="string"||!e.session.id||e.session.id.length>240||e.session.model!==this.options.model)throw Error();s.wireSessionId=e.session.id;return;
      }
      if(e.type==="session.updated"){
        if(s.configured)throw Error();assertQwenAsrConfiguration(e.session,this.options.model,this.options.language,this.options.serverVad);
        if(s.wireSessionId&&s.wireSessionId!==e.session.id)throw Error();s.wireSessionId=e.session.id;s.configured=true;s.ready.resolve();return;
      }
      if(e.type==="session.finished"){
        if(!s.finishing||s.providerFinished)throw Error();s.providerFinished=true;s.finished.resolve();return;
      }
      let turn=s.turn;
      if(e.type==="input_audio_buffer.speech_started"){
        const transport=s.qwenTransport;
        if(!transport?.sent||transport.terminal||turn||!key(e.item_id)||!Number.isSafeInteger(e.audio_start_ms)||e.audio_start_ms<0)throw Error();
        const start=Math.round(e.audio_start_ms*this.rate/1000);
        if(start<transport.event.audioStartSample!||start>transport.event.audioEndSample!)throw Error();
        turn={event:{...transport.event,segmentId:randomUUID(),audioStartSample:start,audioEndSample:transport.event.audioEndSample},
          prepared:true,sent:true,terminal:false,committing:false,ack:false,partial:"",done:deferred<Result>()};s.turn=turn;
        turn.providerItemId=e.item_id;turn.itemId=e.item_id;turn.previousItem=s.lastItem;turn.providerStartSample=start;
        logPublicAsrBoundary({sessionId:this.options.sessionId,stage:"speech_start",itemId:e.item_id,
          segmentId:turn.event.segmentId,startSample:start,acceptedSamples:s.cursor});return;
      }
      if(e.type==="input_audio_buffer.speech_stopped"){
        if(!turn?.sent||turn.terminal||e.item_id!==turn.providerItemId||turn.providerEndSample!==undefined||!Number.isSafeInteger(e.audio_end_ms)||e.audio_end_ms<0)throw Error();
        const transport=s.qwenTransport;if(!transport?.sent||transport.terminal)throw Error();
        const reportedEnd=Math.round(e.audio_end_ms*this.rate/1000),end=Math.min(reportedEnd,transport.event.audioEndSample!);
        // Qwen reports server-VAD boundaries in 100ms steps. A final 40ms
        // phone packet can therefore legitimately end just before the
        // supplier's rounded watermark. Keep the durable attempt immutable:
        // accept only that bounded rounding window and clamp the displayed
        // timing to bytes already accepted by this process.
        if(end<=(turn.providerStartSample??turn.event.audioStartSample!)||reportedEnd>transport.event.audioEndSample!+this.rate/25)throw Error();
        turn.providerEndSample=end;
        logPublicAsrBoundary({sessionId:this.options.sessionId,stage:"speech_stop",itemId:e.item_id,
          segmentId:turn.event.segmentId,startSample:turn.providerStartSample,endSample:end,acceptedSamples:s.cursor});return;
      }
      if(e.type==="conversation.item.created"){
        const item=e.item;if(!turn?.sent||turn.terminal||turn.providerCreated||item?.id!==turn.providerItemId||item.type!=="message"||
          !["assistant","user"].includes(item.role)||!Array.isArray(item.content)||item.content.length!==1||item.content[0]?.type!=="input_audio")throw Error();
        turn.providerCreated=true;return;
      }
      if(e.type==="input_audio_buffer.committed"){
        if(!turn?.sent||turn.terminal||turn.providerEndSample===undefined)throw Error();
        e={...e,item_id:this.qwenTurnItemId(turn,e.item_id),previous_item_id:this.qwenPreviousItem(turn,e.previous_item_id)};
      }
      else if(["conversation.item.input_audio_transcription.text","conversation.item.input_audio_transcription.completed"].includes(e.type)){
        if(!turn?.sent||turn.terminal)throw Error();
        // Empty finals withdraw the existing draft; they need no language
        // routing. Validate text/item structure below before completing them.
        turn.detectedLanguage=e.type.endsWith(".completed")&&typeof e.transcript==="string"&&!cleanRealtimeText(e.transcript)
          ? undefined : (e.type.endsWith(".text")?qwenDraftTranscriptLanguage:qwenTranscriptLanguage)(e.language,this.options.language,this.options.automaticLanguagePair,this.options.automaticSourceLanguages);
        if(e.type.endsWith(".completed")&&typeof e.transcript==="string"&&cleanRealtimeText(e.transcript)&&turn.detectedLanguage===undefined)turn.unsupportedLanguage=e.language;
        e={...e,item_id:this.qwenTurnItemId(turn,e.item_id)};
      }else throw Error();
    }
    if(e.type==="session.created")return;
    if(e.type==="session.updated"){
      const input=e.session?.audio?.input,transcription=input?.transcription,expected=this.transcription();
      const expectedLanguage="language" in expected?expected.language:undefined;
      if(e.session?.type!=="transcription"||input?.format?.type!=="audio/pcm"||input.format.rate!==24000||input.turn_detection!==null||
        transcription?.model!==expected.model||("languages"in expected?JSON.stringify(transcription.languages)!==JSON.stringify(expected.languages):transcription.language!==expectedLanguage))throw Error();
      s.configured=true;s.ready.resolve();return;
    }
    if(e.type==="error"||e.type==="conversation.item.input_audio_transcription.failed")throw Error();
    if(!["input_audio_buffer.committed","conversation.item.input_audio_transcription.delta","conversation.item.input_audio_transcription.completed"].includes(e.type)&&
      !(this.qwen&&e.type==="conversation.item.input_audio_transcription.text"))return;
    if(typeof e.item_id!=="string"||!e.item_id||e.item_id.length>240)throw Error();if(s.seen.has(e.item_id))return;
    const turn=s.turn;if(!turn?.sent||turn.terminal)throw Error();
    if(turn.itemId&&turn.itemId!==e.item_id)throw Error();turn.itemId=e.item_id;
    if(e.type==="input_audio_buffer.committed"){
      if(this.qwen){if((e.previous_item_id??undefined)!==turn.previousItem)throw Error();turn.ack=true;}
      else {if(!turn.committing||(e.previous_item_id??undefined)!==turn.previousItem)throw Error();turn.ack=true;s.lastItem=e.item_id;}
    }else{
      if(e.content_index!==0)throw Error();
      if(this.qwen&&e.type.endsWith(".text")){
        if(typeof e.text!=="string"||typeof e.stash!=="string"||e.text.length+e.stash.length>16000||!e.text.startsWith(turn.confirmedPrefix??""))throw Error();
        turn.confirmedPrefix=e.text;turn.partial=e.text+e.stash;
        const text=cleanRealtimeText(turn.partial);if(text&&turn.detectedLanguage!==undefined){turn.previewLanguage=turn.detectedLanguage;this.partialListener?.({segmentId:turn.event.segmentId,revision:0,isFinal:false,text,language:this.transcriptLanguage(turn)});}
      }else if(e.type.endsWith(".delta")){if(typeof e.delta!=="string"||turn.partial.length+e.delta.length>16000)throw Error();turn.partial+=e.delta;
        const text=cleanRealtimeText(turn.partial);if(text)this.partialListener?.({segmentId:turn.event.segmentId,revision:0,isFinal:false,text,language:this.transcriptLanguage()});}
      else {if(!this.qwen&&!turn.committing)throw Error();const result=parseOpenAiAsr({text:e.transcript,...(!this.qwen&&e.usage!==undefined?{usage:e.usage}:{})},this.qwen?turn.providerItemId??null:e.item_id);
        if(turn.result&&JSON.stringify(turn.result)!==JSON.stringify(result))throw Error();turn.result=result;
        if(this.qwen)logPublicAsrBoundary({sessionId:this.options.sessionId,stage:"completed",itemId:turn.providerItemId,
          segmentId:turn.event.segmentId,startSample:turn.providerStartSample,endSample:turn.providerEndSample,
          acceptedSamples:s.cursor,textCharCount:result.text.length,language:turn.detectedLanguage});}
    }
    if(turn.ack&&turn.result){if(this.qwen){completeQwenTurn(s,turn,this.transcriptLanguage(turn),this.options.language==="auto",this.rate);
      if(!turn.unsupportedLanguage)logPublicAsrBoundary({sessionId:this.options.sessionId,stage:"emitted",itemId:turn.providerItemId,
        segmentId:turn.event.segmentId,startSample:turn.providerStartSample,endSample:turn.providerEndSample,
        acceptedSamples:s.cursor,textCharCount:turn.result.text.length,language:turn.detectedLanguage});
    }else turn.done.resolve(turn.result);}
  }
  private qwenTurnItemId(turn:Turn,value:unknown){
    if(typeof value!=="string"||!value||value.length>240||turn.providerItemId!==value)throw Error();return value;
  }
  private qwenPreviousItem(turn:Turn,value:unknown){
    if(value==="")value=undefined;
    if(value!==undefined&&value!==turn.previousItem)throw Error();
    return turn.previousItem;
  }
}
