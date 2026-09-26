import type {State} from "./streaming-asr-state.js";

const reasons=new Set([
  "event_id_invalid","event_id_duplicate","start_transport_missing","start_transport_terminal",
  "start_previous_turn_pending","start_item_invalid","start_time_invalid","start_before_transport","start_after_transport",
  "stop_turn_missing","stop_turn_terminal","stop_item_mismatch","stop_already_seen","stop_time_invalid",
  "stop_transport_missing","stop_transport_terminal","stop_before_start","stop_after_transport","other",
]);
class QwenWireValidationError extends Error {
  constructor(readonly reason:string){super("Qwen ASR wire validation rejected");}
}
export function rejectQwenWire(reason:string):never {
  throw new QwenWireValidationError(reasons.has(reason)?reason:"other");
}
const itemKey=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(v);

// These are the existing checks, separated to identify the exact rejection.
// No rounding allowance, identity, watermark, or ordering rule is relaxed here.
export function qwenSpeechStartSample(s:State,e:Record<string,any>,rate:number){
  const transport=s.qwenTransport;
  if(!transport?.sent)rejectQwenWire("start_transport_missing");
  if(transport.terminal)rejectQwenWire("start_transport_terminal");
  if(s.turn)rejectQwenWire("start_previous_turn_pending");
  if(!itemKey(e.item_id))rejectQwenWire("start_item_invalid");
  if(!Number.isSafeInteger(e.audio_start_ms)||e.audio_start_ms<0)rejectQwenWire("start_time_invalid");
  const start=Math.round(e.audio_start_ms*rate/1000);
  if(start<transport.event.audioStartSample!)rejectQwenWire("start_before_transport");
  if(start>transport.event.audioEndSample!)rejectQwenWire("start_after_transport");
  return start;
}
export function qwenSpeechStopSample(s:State,e:Record<string,any>,rate:number){
  const turn=s.turn,transport=s.qwenTransport;
  if(!turn?.sent)rejectQwenWire("stop_turn_missing");
  if(turn.terminal)rejectQwenWire("stop_turn_terminal");
  if(e.item_id!==turn.providerItemId)rejectQwenWire("stop_item_mismatch");
  if(turn.providerEndSample!==undefined)rejectQwenWire("stop_already_seen");
  if(!Number.isSafeInteger(e.audio_end_ms)||e.audio_end_ms<0)rejectQwenWire("stop_time_invalid");
  if(!transport?.sent)rejectQwenWire("stop_transport_missing");
  if(transport.terminal)rejectQwenWire("stop_transport_terminal");
  const reportedEnd=Math.round(e.audio_end_ms*rate/1000),end=Math.min(reportedEnd,transport.event.audioEndSample!);
  if(end<=(turn.providerStartSample??turn.event.audioStartSample!))rejectQwenWire("stop_before_start");
  // Preserve the existing final-packet (40ms) provider rounding allowance.
  if(reportedEnd>transport.event.audioEndSample!+rate/25)rejectQwenWire("stop_after_transport");
  return end;
}

const booleanFields=["finishing","busy","turnPresent","turnAck","turnTerminal","turnHasResult","itemMatchesTurn","transportTerminal"];
const sampleFields=["uploadedSamples","transportStartSample","transportEndSample","turnStartSample","turnEndSample"];
const timeFields=["audioStartMs","audioEndMs"];
export function sanitizeQwenProtocolDiagnostic(value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const v=value as Record<string,unknown>,out:Record<string,unknown>={reason:typeof v.reason==="string"&&reasons.has(v.reason)?v.reason:"other"};
  for(const key of booleanFields)if(typeof v[key]==="boolean")out[key]=v[key];
  for(const key of sampleFields)if(typeof v[key]==="number"&&Number.isSafeInteger(v[key])&&v[key]>=0)out[key]=v[key];
  for(const key of timeFields)if(typeof v[key]==="number"&&Number.isFinite(v[key])&&v[key]>=0&&v[key]<=604800000)out[key]=v[key];
  if(typeof v.pendingEvents==="number"&&Number.isInteger(v.pendingEvents)&&v.pendingEvents>=0&&v.pendingEvents<=4096)out.pendingEvents=v.pendingEvents;
  return out;
}
export function qwenProtocolDiagnostic(s:State,e:Record<string,any>,error:unknown){
  return sanitizeQwenProtocolDiagnostic({
    reason:error instanceof QwenWireValidationError?error.reason:"other",
    audioStartMs:e?.audio_start_ms,audioEndMs:e?.audio_end_ms,uploadedSamples:s.cursor,
    transportStartSample:s.qwenTransport?.event.audioStartSample,transportEndSample:s.qwenTransport?.event.audioEndSample,
    turnStartSample:s.turn?.providerStartSample,turnEndSample:s.turn?.providerEndSample,
    finishing:s.finishing,busy:s.busy,pendingEvents:s.pendingWireEvents.length,
    turnPresent:!!s.turn,turnAck:s.turn?.ack??false,turnTerminal:s.turn?.terminal??false,
    turnHasResult:!!s.turn?.result,itemMatchesTurn:typeof e?.item_id==="string"&&e.item_id===s.turn?.providerItemId,
    transportTerminal:s.qwenTransport?.terminal??false,
  });
}
