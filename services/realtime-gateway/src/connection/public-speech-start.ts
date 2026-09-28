import type {ClientRealtimeEvent,ServerRealtimeEvent} from "@translation/contracts";
import type {AudioFrameBatcher} from "./audio-frame-batcher.js";
import type {RealtimeTtsOutputQueue} from "../tts/realtime-tts-output.js";
import {getSession} from "../sessions/session-manager.js";

/** A same-socket VAD marker refers to already accepted PCM. It never flushes
 * ASR, changes a model, resumes input, grants budget, or creates a new turn. */
export function handlePublicSpeechStart(event:Extract<ClientRealtimeEvent,{type:"audio.speech_started"}>,
  options:{sessionId:string;confirmed:boolean;batcher:AudioFrameBatcher;tts:RealtimeTtsOutputQueue;send:(e:ServerRealtimeEvent)=>void}) {
  let result:"new"|"duplicate"|"rejected"="rejected";
  if(options.confirmed&&event.sessionId===options.sessionId&&getSession(options.sessionId)?.status==="active"&&
    !Object.keys(event).some(k=>!["type","sessionId","sequence"].includes(k)))result=options.batcher.confirmSpeechStart(event.sequence);
  if(result==="new")options.tts.interrupt();
  options.send({type:result==="rejected"?"audio.speech_started.rejected":"audio.speech_started.confirmed",
    sessionId:options.sessionId,sequence:Number.isSafeInteger(event.sequence)?event.sequence:-1});
}
