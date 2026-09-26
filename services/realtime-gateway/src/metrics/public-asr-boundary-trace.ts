import {createHash} from "node:crypto";
import type {SessionEndReason} from "@translation/contracts";
import type {SegmentPushResult} from "@translation/speech-quality";
import {realtimeLogger} from "./realtime-metrics.js";

type Stage="accepted"|"provider_audio"|"speech_start"|"speech_stop"|"completed"|"emitted"|"persisted";
interface Boundary {
  sessionId:string;stage:Stage;itemId?:string;segmentId?:string;
  sequence?:number;startSample?:number;endSample?:number;acceptedSamples?:number;
  revision?:number;textCharCount?:number;language?:string;
}

/** Opt-in one-shot QA metadata only. Never include PCM, transcript, credentials,
 * or the supplier's raw item identifier in the persisted log. */
export function publicAsrBoundaryTracePayload(value:Boundary){
  return {
    sessionId:value.sessionId,stage:value.stage,
    ...(value.itemId?{itemHash:createHash("sha256").update(value.itemId).digest("hex").slice(0,12)}:{}),
    ...(value.segmentId?{segmentId:value.segmentId}:{}),
    ...(value.sequence===undefined?{}:{sequence:value.sequence}),
    ...(value.startSample===undefined?{}:{startSample:value.startSample}),
    ...(value.endSample===undefined?{}:{endSample:value.endSample}),
    ...(value.acceptedSamples===undefined?{}:{acceptedSamples:value.acceptedSamples}),
    ...(value.revision===undefined?{}:{revision:value.revision}),
    ...(value.textCharCount===undefined?{}:{textCharCount:value.textCharCount}),
    ...(value.language?{language:value.language}:{}),
  };
}

/** Level statistics distinguish digital zero from nonzero input, not speech
 * from room noise. No threshold, VAD decision or filtering is derived here. */
export function publicPcm16Level(pcm:Buffer){
  if(!pcm.length||pcm.length%2!==0)return undefined;
  let peakAbs=0,zeroSamples=0,sumSquares=0;
  for(let offset=0;offset<pcm.length;offset+=2){
    const sample=pcm.readInt16LE(offset);if(sample===0)zeroSamples++;
    peakAbs=Math.max(peakAbs,Math.abs(sample));sumSquares+=sample*sample;
  }
  const sampleCount=pcm.length/2;
  return {sampleCount,zeroSamples,peakAbs,rms:Math.round(Math.sqrt(sumSquares/sampleCount)*1000)/1000};
}

export function logPublicAsrBoundary(value:Boundary,pcm?:Buffer){
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true"||
    process.env.PUBLIC_QA_ONE_SHOT_ENABLED!=="true")return;
  try{
    const audioLevel=pcm&&(value.stage==="accepted"||value.stage==="provider_audio")?publicPcm16Level(pcm):undefined;
    realtimeLogger.info({...publicAsrBoundaryTracePayload(value),...(audioLevel?{audioLevel}:{})},"Public ASR QA boundary");
  }catch{/* QA diagnostics must not advance a watermark then abort the audio path. */}
}

type AssemblyTrigger="push"|"timeout"|"end";
type AssemblyInput={segmentId:string;text:string;revision?:number};
const traceId=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);

/** Distinguish held/merged/superseded finals from lost data without persisting
 * their text. Array bounds limit diagnostic output, never business results. */
export function publicAsrAssemblyTracePayload(sessionId:string,trigger:AssemblyTrigger,result:SegmentPushResult,input?:AssemblyInput){
  if(!traceId(sessionId)||!["push","timeout","end"].includes(trigger))return undefined;
  const item=(value:SegmentPushResult["ready"][number])=>({
    ...(traceId(value.segmentId)?{segmentId:value.segmentId}:{}),
    ...(Number.isSafeInteger(value.revision)&&value.revision!>=0?{revision:value.revision}:{}),
    textCharCount:value.text.length,
    ...(Number.isFinite(value.timing?.startMs)&&value.timing!.startMs>=0?{startMs:value.timing!.startMs}:{}),
    ...(Number.isFinite(value.timing?.endMs)&&value.timing!.endMs>=0?{endMs:value.timing!.endMs}:{}),
  });
  return {sessionId,stage:"assembly",trigger,
    ...(input&&traceId(input.segmentId)?{inputSegmentId:input.segmentId,inputTextCharCount:input.text.length}:{}),
    readyCount:result.ready.length,ready:result.ready.slice(0,16).map(item),
    ...(result.partial?{held:item(result.partial)}:{}),
    supersededSegmentIds:(result.supersededSegmentIds??[]).filter(traceId).slice(0,16)};
}

export function logPublicAsrAssembly(sessionId:string,trigger:AssemblyTrigger,result:SegmentPushResult,input?:AssemblyInput){
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true"||process.env.PUBLIC_QA_ONE_SHOT_ENABLED!=="true")return;
  if(!input&&!result.ready.length&&!result.partial&&!result.supersededSegmentIds?.length)return;
  try{const payload=publicAsrAssemblyTracePayload(sessionId,trigger,result,input);
    if(payload)realtimeLogger.info(payload,"Public ASR QA boundary");
  }catch{/* Diagnostic failures do not change assembly, translation or stop. */}
}

type EndStage="requested"|"flush_unconfirmed"|"sync_unconfirmed"|"sync_drained";
interface EndBoundary {sessionId:string;reason:SessionEndReason;stage:EndStage}
const endReasons=new Set<SessionEndReason>(["client_request","quota_exhausted","time_limit",
  "inactivity_timeout","connection_closed","connection_error"]);
const endStages=new Set<EndStage>(["requested","flush_unconfirmed","sync_unconfirmed","sync_drained"]);

/** A protocol end reason is not proof that a person pressed the stop button.
 * Keep it separate from ASR text, close-message text and billing assertions. */
export function publicSessionEndTracePayload(value:EndBoundary){
  if(typeof value.sessionId!=="string"||!/^[A-Za-z0-9_.:-]{1,200}$/.test(value.sessionId)||
    !endReasons.has(value.reason)||!endStages.has(value.stage))return undefined;
  return {sessionId:value.sessionId,reason:value.reason,stage:value.stage};
}

export function logPublicSessionEnd(value:EndBoundary){
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true"||
    process.env.PUBLIC_QA_ONE_SHOT_ENABLED!=="true")return;
  const payload=publicSessionEndTracePayload(value);if(!payload)return;
  try{realtimeLogger.info(payload,"Public session QA finalization");}
  catch{/* Diagnostic I/O must not interrupt physical/provider shutdown. */}
}
