import WebSocket from "ws";
import {randomUUID} from "node:crypto";
import {abortable} from "../providers/abortable.js";
import type {State} from "./streaming-asr-state.js";

/** Passive, monotonic-clock diagnostics. A completed write is NOT a supplier
 * inference acknowledgement or settlement evidence. No text/audio is retained. */
export interface AudioSendObservations {
  started: number; completed: number; failed: number;
  lastStartedAt: number; lastCompletedAt?: number;
  maxGapMs: number; maxPacketMs: number; pendingMs: number;
}
export async function sendStreamingAsrWireEvent(s:State,event:unknown,qwen:boolean,rate:number) {
  if(s.ws?.readyState!==WebSocket.OPEN||s.ws.bufferedAmount>1048576)throw Error("socket not writable");
  const e=event as {type?:unknown;audio?:unknown}|null;
  let observation:AudioSendObservations|undefined;
  if(e?.type==="input_audio_buffer.append"&&typeof e.audio==="string"){
    const now=performance.now(),duration=Buffer.byteLength(e.audio,"base64")/2/rate*1000;
    observation=s.audioSend??={started:0,completed:0,failed:0,lastStartedAt:now,maxGapMs:0,maxPacketMs:0,pendingMs:0};
    if(observation.started>0)observation.maxGapMs=Math.max(observation.maxGapMs,now-observation.lastStartedAt);
    observation.started++;observation.lastStartedAt=now;
    observation.maxPacketMs=Math.max(observation.maxPacketMs,duration);observation.pendingMs=duration;
  }
  let completed=false;
  try{
    await abortable(new Promise<void>((resolve,reject)=>s.ws!.send(
      JSON.stringify(qwen?{...(event as object),event_id:randomUUID()}:event),
      error=>error?reject(Error("send failed")):resolve())),s.stop.signal);
    completed=true;
  }finally{
    if(observation){
      if(completed){observation.completed++;observation.lastCompletedAt=performance.now();}
      else observation.failed++;
      observation.pendingMs=0;
    }
  }
}
export function streamingAsrSendDiagnostic(observation?:AudioSendObservations,now=performance.now()) {
  if(!observation)return {};
  const values={appendStarted:observation.started,appendCompleted:observation.completed,appendFailed:observation.failed,
    lastAppendAgeMs:now-observation.lastStartedAt,
    lastCompletedAgeMs:observation.lastCompletedAt===undefined?undefined:now-observation.lastCompletedAt,
    maxAppendGapMs:observation.maxGapMs,maxPacketAudioMs:observation.maxPacketMs,pendingAudioMs:observation.pendingMs};
  return {audioSend:Object.fromEntries(Object.entries(values).filter(([,v])=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=Number.MAX_SAFE_INTEGER)
    .map(([key,value])=>[key,Math.round(value!)]))};
}
