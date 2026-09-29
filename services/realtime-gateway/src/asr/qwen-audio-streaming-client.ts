import WebSocket from 'ws';
import {randomUUID} from 'node:crypto';
import type {PublicModelAttemptEvent,TranscriptEvent} from '@translation/contracts';
import type {AsrSession,TranscriptResult,AsrLanguageNotice,AsrFailureNotice} from './asr-provider.js';
import type {HttpAsrRequest,HttpAsrFlushRequest,HttpAsrBoundaryRequest} from './http-asr-client.js';
import type {StreamingAsrOptions} from './openai-streaming-asr-client.js';
import type {DeviceTextLanguageBroker} from '../connection/device-text-language.js';
import {PublicAsrError} from './public-asr-completed-audio.js';
import {deferred} from './streaming-asr-state.js';
import {abortable} from '../providers/abortable.js';
import {cleanRealtimeText} from '../protocol/realtime-text.js';
import {realtimeLogger} from '../metrics/realtime-metrics.js';
import {logPublicAsrLanguage} from '../metrics/public-asr-boundary-trace.js';
import {tracePublicAsrFinal} from '../metrics/public-audio-evidence-trace.js';
import {streamingAsrFailureDiagnostic,streamingAsrProviderContext,streamingAsrCloseContext,streamingAsrTransportContext,
  streamingAsrCancellationContext,type StreamingAsrFailureContext} from './streaming-asr-diagnostics.js';
import {decodeQwenAudioEvent,qwenAudioFinishTask,qwenAudioRunTask,QwenAudioCumulativeUsage,type QwenAudioSentence} from './qwen-audio-streaming-protocol.js';
import {routeQwenAudioLanguage,type RoutedAudioSentence} from './qwen-audio-language-routing.js';

export interface QwenAudioStreamingOptions extends Omit<StreamingAsrOptions,'wireProfile'> {
  textLanguage?:DeviceTextLanguageBroker;
  preview?:(event:TranscriptEvent)=>void;
  streaming:{semanticPunctuation:boolean;heartbeat:boolean};
}
/** Original HttpAsrProvider transport. One supplier task/attempt, continuous PCM,
 * no implicit retry/reconnect and no provider task finish on a phone VAD boundary. */
export class QwenAudioStreamingClient {
  private ws?:WebSocket;
  private stop=new AbortController();
  private started=deferred<void>();
  private finished=deferred<void>();
  private taskId=randomUUID();
  private initialized=false;
  private connectPromise?:Promise<void>;
  private runTask?:ReturnType<typeof qwenAudioRunTask>;
  private failureListener?: (failure:AsrFailureNotice)=>void;
  private finishing=false;
  private providerFinished=false;
  private failure?:PublicAsrError;
  private cursor=0;
  private sequence=-1;
  private busy=false;
  private sent=false;
  private attempt?:PublicModelAttemptEvent;
  private terminal?:Promise<void>;
  private usage=new QwenAudioCumulativeUsage();
  private completed:TranscriptResult[]=[];
  private notices:AsrLanguageNotice[]=[];
  private queued:unknown[]=[];
  private languageWork=Promise.resolve();
  private languagePending=0;
  private lastFinal=0;
  private lastFinalText='';
  private removeAbort=()=>{};
  private get rate(){return this.options.sampleRate!;}
  constructor(private readonly options:QwenAudioStreamingOptions){}

  async createSession(session:AsrSession,signal:AbortSignal){
    if(this.initialized||session.sessionId!==this.options.sessionId||session.sourceLanguage!==this.options.language||session.asrCorrections?.length||
      session.sourceLanguage==='auto'&&!this.options.textLanguage)throw new PublicAsrError('qwen_audio_scope_invalid','not_sent');
    const vocabulary=session.asrHotwords?.length?Object.fromEntries(session.asrHotwords.map(t=>[t,4])):undefined;
    this.runTask=qwenAudioRunTask({taskId:this.taskId,model:this.options.model,sampleRate:this.rate,
      ...this.options.streaming,...(session.sourceLanguage==='auto'?{}:{languageHints:[session.sourceLanguage]}),...(vocabulary?{vocabulary}:{})});
    this.initialized=true;
    const cancel=()=>{if(!this.providerFinished)this.fail('qwen_audio_cancelled',streamingAsrCancellationContext(signal));};
    signal.addEventListener('abort',cancel,{once:true});this.removeAbort=()=>signal.removeEventListener('abort',cancel);
    if(signal.aborted)cancel();
    this.assert();
  }
  /** Open one task only after the first accepted PCM prefix has durable intent.
   * A phone capture failure with no PCM cannot create an idle supplier task. */
  private connect() {
    this.connectPromise??=this.bounded('qwen_audio_setup_timeout',async()=>{
      await abortable(this.options.authorizeConnection(),this.stop.signal);this.assert();
      const credentials=await abortable(Promise.resolve(this.options.resolveCredentials(this.stop.signal)),this.stop.signal);this.assert();
      if(!credentials.apiKey||credentials.apiKey.trim()!==credentials.apiKey||/[\r\n]/.test(credentials.apiKey))throw Error();
      this.ws=(this.options.socketFactory??((url,options)=>new WebSocket(url,options)))(this.options.endpoint,
        {headers:{Authorization:`Bearer ${credentials.apiKey}`},handshakeTimeout:this.options.timeoutMs,maxPayload:262144,perMessageDeflate:false,followRedirects:false});
      this.ws.on('error',error=>this.fail('qwen_audio_transport_error',streamingAsrTransportContext(error)));
      this.ws.on('close',(code,reason)=>{if(!this.providerFinished)this.fail('qwen_audio_closed',streamingAsrCloseContext(code,reason));});
      this.ws.on('message',(data,binary)=>{
        if(this.failure)return;
        try{
          if(binary||Buffer.byteLength(data.toString())>262144)throw Error();
          const event=JSON.parse(data.toString());
          if(event?.header?.event==='task-failed'&&event.header.task_id===this.taskId){
            this.fail('qwen_audio_task_failed',{...streamingAsrProviderContext({error:{code:event.header.error_code,message:event.header.error_message}}),providerTaskId:this.taskId});return;
          }
          if(this.busy&&event?.header?.event!=='task-started'){if(this.queued.length>=512)throw Error();this.queued.push(event);}else this.receive(event);
        }catch(error){this.fail(error instanceof Error&&/^qwen_audio_[a-z_]+$/.test(error.message)?error.message:'qwen_audio_protocol_error');}
      });
      this.ws.once('open',()=>{void this.send(JSON.stringify(this.runTask!)).catch(()=>this.fail('qwen_audio_setup_send_failed'));});
      await abortable(this.started.promise,this.stop.signal);this.assert();
    });
    return this.connectPromise;
  }
  async transcribe(request:HttpAsrRequest,signal?:AbortSignal){
    this.scope(request.sessionId);this.assert();
    const pcm=Buffer.from(request.data,'base64');
    if(this.busy||this.finishing||request.sourceLanguage!==this.options.language||request.sampleRate!==this.rate||request.format!=='pcm16'||
      !pcm.length||pcm.length%2||pcm.length>this.rate*60||pcm.toString('base64')!==request.data||
      !Number.isSafeInteger(request.sequence)||request.sequence<0||request.sequence<=this.sequence||!Number.isFinite(request.timestampMs)||request.timestampMs<0||!request.acceptedAudioRange||
      request.acceptedAudioRange.startSample!==this.cursor||request.acceptedAudioRange.endSample!==this.cursor+pcm.length/2)
      {this.fail('qwen_audio_audio_invalid');throw this.failure!;}
    this.busy=true;
    try{return await this.bounded('qwen_audio_append_failed',async()=>{
      if(signal?.aborted)throw Error();
      const end=this.cursor+pcm.length/2;
      const next:PublicModelAttemptEvent={...(this.attempt??{sessionId:this.options.sessionId,leaseId:this.options.leaseId,attemptId:randomUUID(),
        segmentId:this.taskId,revision:1,component:'asr',providerId:'qwen',modelId:this.options.model,state:'dispatching',audioStartSample:0,audioSampleRate:this.rate}),audioEndSample:end};
      // Save the exact growing prefix BEFORE any corresponding bytes leave.
      await abortable(this.options.record(next),this.stop.signal);this.attempt=next;this.assert();
      await this.connect();this.assert();
      if(signal?.aborted)throw Error();
      for(let offset=0;offset<pcm.length;offset+=this.rate/5){this.sent=true;await this.send(pcm.subarray(offset,offset+this.rate/5));this.assert();}
      this.cursor=end;this.sequence=request.sequence;
      this.drain();return this.completed.splice(0);
    });}finally{this.busy=false;}
  }
  async flush(request:HttpAsrFlushRequest,signal?:AbortSignal){
    this.scope(request.sessionId);
    if(request.finishSession&&!this.sent&&this.cursor===0&&this.lastFinal===0&&this.languagePending===0){
      if(this.failure?.outcome==='not_sent'){await this.recordTerminal('not_sent');return [];}
      if(!this.connectPromise){this.providerFinished=true;return [];}
    }
    this.assert();this.drain();
    if(!request.finishSession)return this.completed.splice(0);
    return this.bounded('qwen_audio_finish_failed',async()=>{
      if(signal?.aborted)throw Error();
      if(!this.finishing){this.finishing=true;await this.send(JSON.stringify(qwenAudioFinishTask(this.taskId)));}
      await abortable(this.finished.promise,this.stop.signal);this.assert();
      await abortable(this.languageWork,this.stop.signal);this.assert();
      await this.recordTerminal('confirmed');
      return this.completed.splice(0);
    });
  }
  async commitBoundary(request:HttpAsrBoundaryRequest,signal?:AbortSignal){
    if(!Number.isFinite(request.boundaryMs)||Math.abs(request.boundaryMs-this.cursor/this.rate*1000)>1)
      throw new PublicAsrError('qwen_audio_boundary_mismatch','not_sent');
    return this.flush({...request,finishSession:false},signal);
  }
  private receive(raw:unknown){
    const event=decodeQwenAudioEvent(raw,this.taskId,this.cursor,this.rate);
    if(event.kind==='started'){
      if(this.providerFinished||this.startedSeen)throw Error();this.startedSeen=true;this.started.resolve();return;
    }
    if(!this.startedSeen||this.providerFinished)throw Error();
    if(event.usage)this.usage.observe({input_tokens:event.usage.promptTokens,output_tokens:event.usage.completionTokens,
      total_tokens:event.usage.totalTokens,duration:event.usage.audioSeconds});
    if(event.kind==='finished'){
      if(!this.finishing)throw Error();this.providerFinished=true;this.finished.resolve();return;
    }
    if(event.kind!=='result')return;
    const sentence=event.sentence,id=`${this.taskId}:${sentence.sentenceId}`;
    if(sentence.sentenceId<=this.lastFinal){
      if(sentence.sentenceId===this.lastFinal&&sentence.isFinal&&sentence.text===this.lastFinalText)return;
      if(!sentence.isFinal)return;throw Error();
    }
    if(!sentence.isFinal){
      const text=cleanRealtimeText(sentence.text);if(text)this.options.preview?.({type:'transcript.partial',sessionId:this.options.sessionId,
        segmentId:id,revision:0,text,language:this.options.language});return;
    }
    this.lastFinal=sentence.sentenceId;this.lastFinalText=sentence.text;
    tracePublicAsrFinal(this.options.sessionId,id,sentence.text,sentence.startMs,sentence.endMs!,sentence.tokenTimings);
    if(this.languagePending>=32||this.completed.length+this.notices.length>=256)throw Error();
    this.languagePending++;
    // Start LID immediately, independently of PCM ingestion; preserve final order
    // when delivering to the original assembler/MT path.
    const routed:Promise<RoutedAudioSentence[]>=!cleanRealtimeText(sentence.text)
      ? Promise.resolve([{id,sentence,decision:{status:'unknown',reason:'ambiguous'}}])
      : this.options.language==='auto'?routeQwenAudioLanguage(sentence,id,this.options.textLanguage!):
        Promise.resolve([{id,sentence,decision:{status:'detected',language:this.options.language,confidence:1}}]);
    this.languageWork=this.languageWork.then(async()=>{
      const results=await routed;
      if(this.failure||this.stop.signal.aborted)return;
      if(this.completed.length+this.notices.length+results.length+(results.length>1?1:0)>256)throw Error('qwen_audio_result_capacity');
      if(results.length>1)this.notices.push({segmentId:id,revision:1,language:'unknown',unconfirmedText:'',discarded:true});
      for(const {id:childId,sentence:child,decision:language} of results){
        logPublicAsrLanguage({sessionId:this.options.sessionId,segmentId:childId,revision:1,stage:'language_routing',startMs:child.startMs,endMs:child.endMs,
          tokenTimingCount:child.tokenTimings?.length??0,childCount:results.length,...language});
        const text=cleanRealtimeText(child.text);
        if(!text){this.notices.push({segmentId:childId,revision:1,language:'unknown',unconfirmedText:'',discarded:true});continue;}
        if(language.status!=='detected'){
          this.notices.push({segmentId:childId,revision:1,language:'unknown',unconfirmedText:child.text,
            timing:{startMs:child.startMs,endMs:child.endMs!,source:'model'}});continue;
        }
        this.completed.push(this.transcript(child,childId,language.language));
      }
    }).catch(()=>this.fail('qwen_audio_result_failed')).finally(()=>{this.languagePending--;});
  }
  private startedSeen=false;
  private transcript(sentence:QwenAudioSentence,id:string,language:TranscriptResult['language']):TranscriptResult{
    const text=cleanRealtimeText(sentence.text)!;
    const left=sentence.text.length-sentence.text.trimStart().length;
    // Only trimming is losslessly rebasable. If cleanup rewrote inner text,
    // retain the source but omit alignment rather than moving words by guess.
    const tokenTimings=text===sentence.text.trim()?sentence.tokenTimings?.flatMap(token=>{
      if(token.characterStart===undefined||token.characterEnd===undefined)return [];
      const start=Math.max(0,token.characterStart-left),end=Math.min(text.length,token.characterEnd-left);
      return end>start&&text.slice(start,end).trim()?[{...token,text:text.slice(start,end),characterStart:start,characterEnd:end}]:[];
    }):undefined;
    return {segmentId:id,revision:1,isFinal:true,text,language,
      ...(this.options.language==='auto'?{automaticLanguageStatus:'detected' as const}:{}),
      timing:{startMs:sentence.startMs,endMs:sentence.endMs!,source:'model'},...(tokenTimings?.length?{tokenTimings}:{})};
  }
  private drain(){for(const raw of this.queued.splice(0))this.receive(raw);this.assert();}
  private async send(data:string|Buffer){
    this.assert();if(this.ws?.readyState!==1)throw Error();
    await abortable(new Promise<void>((resolve,reject)=>this.ws!.send(data,error=>error?reject(error):resolve())),this.stop.signal);
  }
  private async bounded<T>(code:string,work:()=>Promise<T>):Promise<T>{
    const timer=setTimeout(()=>this.fail(code),this.options.timeoutMs);
    try{return await work();}catch{this.fail(code);await this.recordTerminal(this.sent?'uncertain':'not_sent');throw this.failure!;}
    finally{clearTimeout(timer);}
  }
  private recordTerminal(state:'confirmed'|'uncertain'|'not_sent'){
    if(!this.attempt)return Promise.resolve();
    // A missing API acknowledgement is not confirmation and must not hang End
    // forever. Keep the SAME write/promise; never retry a possibly committed row.
    this.terminal??=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new PublicAsrError('qwen_audio_attempt_record_timeout','uncertain')),this.options.timeoutMs);
      Promise.resolve().then(()=>this.options.record({...this.attempt!,state,...(state==='confirmed'?{}:{failureCode:this.failure?.code??'qwen_audio_closed'}),
        metadata:{requestId:this.taskId,...(this.usage.latest()?{usage:this.usage.latest()}:{})}}))
        .then(()=>{clearTimeout(timer);resolve();},error=>{clearTimeout(timer);reject(error);});
    });
    return this.terminal;
  }
  private fail(code:string,context?:StreamingAsrFailureContext){
    if(this.failure)return;this.failure=new PublicAsrError(code,this.sent?'uncertain':'not_sent');
    realtimeLogger.warn({sessionId:this.options.sessionId,protocol:'qwen_audio_streaming',
      ...streamingAsrFailureDiagnostic(code,undefined,this.cursor,this.options.language,context)},'Public streaming ASR failure');
    this.stop.abort();this.options.textLanguage?.close();this.ws?.terminate();
    const listener=this.failureListener;
    if(listener&&context?.origin!=='explicit_close')queueMicrotask(()=>{
      if(this.failureListener===listener)listener({code:this.failure!.code,outcome:this.failure!.outcome});
    });
  }
  private assert(){if(this.failure)throw this.failure;}
  private scope(sessionId:string){if(sessionId!==this.options.sessionId)throw new PublicAsrError('qwen_audio_scope_invalid','not_sent');}
  takeLanguageNotices(sessionId:string){this.scope(sessionId);return this.notices.splice(0);}
  setFailureListener(sessionId:string,listener:(failure:AsrFailureNotice)=>void){
    this.scope(sessionId);this.failureListener=listener;
    if(this.failure)queueMicrotask(()=>{if(this.failureListener===listener)listener({code:this.failure!.code,outcome:this.failure!.outcome});});
    return ()=>{if(this.failureListener===listener)this.failureListener=undefined;};
  }
  async closeSession(sessionId:string){
    this.scope(sessionId);this.removeAbort();this.options.textLanguage?.close();
    if(!this.providerFinished)this.fail('qwen_audio_closed',{origin:'explicit_close'});
    this.stop.abort();this.ws?.terminate();await this.recordTerminal(this.providerFinished?'confirmed':this.sent?'uncertain':'not_sent');
  }
  async diagnostics():Promise<never>{throw Error('qwen_audio_vad_diagnostics_not_reported');}
  async healthCheck(){return this.startedSeen&&!this.failure&&!this.providerFinished;}
}
