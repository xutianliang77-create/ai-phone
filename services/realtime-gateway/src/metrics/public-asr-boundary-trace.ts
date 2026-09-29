import {createHash} from "node:crypto";
import type {SessionEndReason} from "@translation/contracts";
import type {SegmentPushResult} from "@translation/speech-quality";
import {realtimeLogger} from "./realtime-metrics.js";

type Stage="accepted"|"provider_audio"|"speech_start"|"speech_stop"|"completed"|"emitted"|"persisted"|"phone_speech_start"|"phone_boundary";
interface Boundary {
  sessionId:string;stage:Stage;itemId?:string;segmentId?:string;
  sequence?:number;startSample?:number;endSample?:number;acceptedSamples?:number;
  revision?:number;textCharCount?:number;language?:string;
}

/** Opt-in QA metadata only. Never include PCM, transcript, credentials,
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
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true")return;
  try{
    const audioLevel=pcm&&(value.stage==="accepted"||value.stage==="provider_audio")?publicPcm16Level(pcm):undefined;
    const pcmSha256=audioLevel&&pcm?createHash('sha256').update(pcm).digest('hex'):undefined;
    // Hex digests can accidentally contain an 11-digit phone number and be
    // redacted. Numeric bytes retain an exact digest without exempting any
    // string or log field from the existing privacy sanitizer.
    const pcmDigestBytes=pcmSha256?Array.from(Buffer.from(pcmSha256,'hex')):undefined;
    realtimeLogger.info({...publicAsrBoundaryTracePayload(value),...(audioLevel?{audioLevel,pcmSha256,pcmDigestBytes}:{})},"Public ASR QA boundary");
  }catch{/* QA diagnostics must not advance a watermark then abort the audio path. */}
}

interface LanguageTrace {
  sessionId:string;segmentId:string;revision:number;
  stage:'language_observation'|'language_decision'|'language_routing';
  sourceTextSha256?:string;observationTextSha256?:string;projection?:string;
  dominant?:string|null;hypotheses?:Record<string,number>;canonicalHypotheses?:Record<string,number>;substantial?:boolean;shortObservation?:boolean;
  status?:string;language?:string;confidence?:number;reason?:string;
  startMs?:number;endMs?:number;tokenTimingCount?:number;childCount?:number;
}
/** Same opt-in non-content trace as PCM/assembly; diagnostics must never abort
 * receipt acceptance, language resolution, audio delivery or normal End. */
export function logPublicAsrLanguage(value:LanguageTrace){
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=='true')return;
  try{realtimeLogger.info(value,'Public ASR language evidence');}catch{/* diagnostic only */}
}

type AssemblyTrigger="push"|"timeout"|"end"|"speaker"|"audio_boundary";
type AssemblyInput=Pick<import("../asr/asr-provider.js").TranscriptResult,"segmentId"|"text"|"revision"|"speaker"|"turnId"|"timing"|"automaticLanguageStatus"|"mixedLanguage">;
const traceId=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_.:-]{1,200}$/.test(v);

/** Distinguish held/merged/superseded finals from lost data without persisting
 * their text. Array bounds limit diagnostic output, never business results. */
export function publicAsrAssemblyTracePayload(sessionId:string,trigger:AssemblyTrigger,result:SegmentPushResult,input?:AssemblyInput){
  if(!traceId(sessionId)||!["push","timeout","end","speaker","audio_boundary"].includes(trigger))return undefined;
  const item=(value:AssemblyInput)=>({
    ...(traceId(value.segmentId)?{segmentId:value.segmentId}:{}),
    ...(Number.isSafeInteger(value.revision)&&value.revision!>=0?{revision:value.revision}:{}),
    textCharCount:value.text.length,
    ...(Number.isFinite(value.timing?.startMs)&&value.timing!.startMs>=0?{startMs:value.timing!.startMs}:{}),
    ...(Number.isFinite(value.timing?.endMs)&&value.timing!.endMs>=0?{endMs:value.timing!.endMs}:{}),
  });
  return {sessionId,stage:"assembly",trigger,
    ...(input&&traceId(input.segmentId)?{inputSegmentId:input.segmentId,inputTextCharCount:input.text.length}:{}),
    ...(input&&traceId(input.turnId)?{inputTurnId:input.turnId}:{}),
    ...(input?.automaticLanguageStatus&&["detected","mixed","unknown"].includes(input.automaticLanguageStatus)?{inputAutomaticLanguageStatus:input.automaticLanguageStatus}:{}),
    ...(typeof input?.mixedLanguage==="boolean"?{inputMixedLanguage:input.mixedLanguage}:{}),
    ...(input?.speaker&&/^(?:device-speaker-[1-4]|unknown)$/.test(input.speaker.speakerId)?{inputSpeakerId:input.speaker.speakerId}:{}),
    ...(input?.timing?{inputTiming:{...item(input),overlap:input.timing.overlap===true}}:{}),
    readyCount:result.ready.length,ready:result.ready.slice(0,16).map(item),
    ...(result.partial?{held:item(result.partial)}:{}),
    supersededSegmentIds:(result.supersededSegmentIds??[]).filter(traceId).slice(0,16)};
}

export function logPublicLateSpeakerExpiry(sessionId:string,info:{elapsedMs:number;maxWindowMs:number;parts:Array<{segmentId:string;revision?:number;language:string;automaticLanguageStatus?:string;mixedLanguage?:boolean;speakerId?:string;startMs?:number;endMs?:number}>},evidence?:{sequence:number;receivedAtMs:number;throughMs:number}) {
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true"||!traceId(sessionId))return;
  const number=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)&&v>=0?v:undefined;
  try{realtimeLogger.info({sessionId,stage:"late_speaker_expired",elapsedMs:number(info.elapsedMs),maxWindowMs:number(info.maxWindowMs),
    parts:info.parts.slice(0,3).filter(p=>traceId(p.segmentId)).map(p=>({segmentId:p.segmentId,revision:number(p.revision),
      language:/^[a-z]{2,3}(?:-Hant)?$/.test(p.language)?p.language:undefined,
      automaticLanguageStatus:["detected","mixed","unknown"].includes(p.automaticLanguageStatus??"")?p.automaticLanguageStatus:undefined,
      mixedLanguage:typeof p.mixedLanguage==="boolean"?p.mixedLanguage:undefined,
      speakerId:/^(?:device-speaker-[1-4]|unknown)$/.test(p.speakerId??"")?p.speakerId:undefined,
      startMs:number(p.startMs),endMs:number(p.endMs)})),
    ...(evidence?{evidence:{sequence:number(evidence.sequence),receivedAtMs:number(evidence.receivedAtMs),throughMs:number(evidence.throughMs)}}:{})},"Public ASR QA boundary");}catch{/* Optional non-content diagnostics cannot fail audio or output. */}
}

export function logPublicAsrAssembly(sessionId:string,trigger:AssemblyTrigger,result:SegmentPushResult,input?:AssemblyInput){
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true")return;
  if(trigger!=="audio_boundary"&&!input&&!result.ready.length&&!result.partial&&!result.supersededSegmentIds?.length)return;
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
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true")return;
  const payload=publicSessionEndTracePayload(value);if(!payload)return;
  try{realtimeLogger.info(payload,"Public session QA finalization");}
  catch{/* Diagnostic I/O must not interrupt physical/provider shutdown. */}
}
