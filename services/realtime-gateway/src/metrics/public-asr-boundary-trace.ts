import {createHash} from "node:crypto";
import type {SessionEndReason} from "@translation/contracts";
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

export function logPublicAsrBoundary(value:Boundary){
  if(process.env.PUBLIC_ASR_BOUNDARY_TRACE_ENABLED!=="true"||
    process.env.PUBLIC_QA_ONE_SHOT_ENABLED!=="true")return;
  realtimeLogger.info(publicAsrBoundaryTracePayload(value),"Public ASR QA boundary");
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
