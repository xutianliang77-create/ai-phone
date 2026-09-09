import type {ClientRealtimeEvent,ServerRealtimeEvent} from "@translation/contracts";
import type {AudioFrameBatcher} from "./audio-frame-batcher.js";
import type {RealtimeProvider} from "../providers/realtime-provider.js";
import {flushProviderSession} from "./session-control-handler.js";
import {getSession} from "../sessions/session-manager.js";

/** Called at message receipt, not after awaiting the control queue. The batcher
 * installs the ordering barrier synchronously; only its work runs asynchronously. */
export function handleAudioBoundary(event:Extract<ClientRealtimeEvent,{type:"audio.boundary"}>,options:{sessionId:string;confirmed:boolean;
  batcher:AudioFrameBatcher;provider:RealtimeProvider;beforeFlush:()=>Promise<void>;drain:()=>Promise<void>;send:(e:ServerRealtimeEvent)=>void;onFailure?:()=>void}){
  const reject=(code="audio_boundary_not_ready")=>options.send({type:"audio.boundary.rejected",sessionId:options.sessionId,sequence:Number.isSafeInteger(event.sequence)?event.sequence:-1,code});
  if(!options.confirmed||event.sessionId!==options.sessionId||getSession(options.sessionId)?.status!=="active"||
    !Number.isSafeInteger(event.sequence)||event.sequence<0||Object.keys(event).some(k=>!["type","sessionId","sequence"].includes(k))){reject();return Promise.resolve();}
  try{return options.batcher.boundaryThrough(event.sequence,async()=>{
    await options.beforeFlush();await flushProviderSession(options.provider,options.sessionId,options.send,true);await options.drain();
  }).then(()=>{options.send({type:"audio.boundary.committed",sessionId:options.sessionId,sequence:event.sequence});},()=>{reject("audio_boundary_commit_failed");options.onFailure?.();});}
  catch{reject();return Promise.resolve();}
}
