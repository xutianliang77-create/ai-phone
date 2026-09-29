/** Logs protocol state only. Never serialize supplier bodies, text or audio.
 * Provider fields follow the Qwen/OpenAI error envelope. Values, including
 * close reasons, are allowlisted: even a short identifier can contain a key. */
import {sanitizeQwenProtocolDiagnostic} from "./qwen-streaming-asr-validation.js";
export const explicitAsrCloseReason=Symbol("explicit_asr_close");
export type StreamingAsrFailureOrigin="caller_abort"|"explicit_close"|"transport_close"|"transport_error"|"provider_error"|"protocol"|"operation";
export interface StreamingAsrFailureContext {
  origin:StreamingAsrFailureOrigin;
  closeCode?:unknown;closeReason?:unknown;closeReasonBytes?:unknown;
  providerErrorCode?:unknown;providerErrorType?:unknown;providerErrorParam?:unknown;transportErrorCode?:unknown;
  providerMessageSignals?:unknown;providerTaskId?:unknown;
  languageValueClass?:unknown;transcriptEmpty?:unknown;
  closeReasonSignals?:unknown;
  protocol?:unknown;
}
const origins=new Set<unknown>(["caller_abort","explicit_close","transport_close","transport_error","provider_error","protocol","operation"]);
const providerCodes=new Set<unknown>([
  "invalid_value","invalid_request_error","invalid_api_key","rate_limit_exceeded","insufficient_quota","server_error",
  "session_expired","transcription_failed","audio_transcription_error","unsupported_language",
  "InvalidApiKey","InvalidParameter","InvalidParameterError","InvalidInput","BadRequest","ModelNotFound",
  "AccessDenied","AccessDenied.Unpurchased","Throttling","Throttling.RateQuota","Throttling.AllocationQuota",
  "AllocationQuotaExceeded","QuotaExhausted","InvalidSubscription","InternalError","ServiceUnavailable",
  "CLIENT_ERROR","SERVER_ERROR","INVALID_REQUEST","REQUEST_TIMEOUT","NO_VALID_AUDIO_ERROR",
]);
const providerTypes=new Set<unknown>(["invalid_request_error","authentication_error","permission_error","rate_limit_error","server_error"]);
const providerParams=new Set<unknown>(["model","audio","language","sample_rate","input_audio_format","input_audio_transcription",
  "input_audio_transcription.language","turn_detection","turn_detection.type","turn_detection.threshold","turn_detection.silence_duration_ms",
  "session.model","session.sample_rate","session.input_audio_format","session.input_audio_transcription","session.input_audio_transcription.language",
  "session.turn_detection","session.turn_detection.type","session.turn_detection.threshold","session.turn_detection.silence_duration_ms","input_audio_buffer.append.audio"]);
const transportCodes=new Set<unknown>(["ECONNRESET","ECONNREFUSED","ETIMEDOUT","ENOTFOUND","EAI_AGAIN","EPIPE","EPROTO",
  "ERR_TLS_CERT_ALTNAME_INVALID","UNABLE_TO_VERIFY_LEAF_SIGNATURE","SELF_SIGNED_CERT_IN_CHAIN","CERT_HAS_EXPIRED"]);
const closeReasons:Readonly<Record<string,string>>={"":"empty","normal closure":"normal_closure","going away":"going_away",
  "session finished":"session_finished","model not found":"model_not_found","idle timeout":"idle_timeout",
  "connection timeout":"connection_timeout","rate limit exceeded":"rate_limit_exceeded","invalid audio":"invalid_audio"};
const closeLabels=new Set<unknown>([...Object.values(closeReasons),"unrecognized"]);
// Signals are allowlisted vocabulary hints, NOT a diagnosis or raw reason.
const reasonSignals:ReadonlyArray<readonly [string,RegExp]>=[
  ["timeout",/time[ _-]?out|timed out|超时/i],["idle",/\bidle\b|空闲/i],
  ["rate_limit",/rate[ _-]?limit|throttl|限流/i],["quota",/\bquota\b|配额|额度/i],
  ["internal",/\binternal\b|内部/i],["overload",/overload|过载/i],
  ["audio",/\baudio\b|音频/i],["protocol",/\bprotocol\b|协议/i],
  ["authentication",/authenticat|unauthori[sz]ed|鉴权/i],["permission",/permission|forbidden|权限/i],
];
const signalLabels=new Set(reasonSignals.map(([label])=>label));
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const safe=(values:ReadonlySet<unknown>,v:unknown)=>values.has(v)?v as string:"unrecognized";

export function streamingAsrCancellationContext(signal?:AbortSignal):StreamingAsrFailureContext {
  return {origin:signal?.reason===explicitAsrCloseReason?"explicit_close":"caller_abort"};
}
export function streamingAsrCloseContext(code:unknown,reason:unknown):StreamingAsrFailureContext {
  const bytes=typeof reason==="string"?Buffer.from(reason):Buffer.isBuffer(reason)?reason:undefined;
  const value=bytes&&bytes.length<=123?bytes.toString("utf8").trim().toLowerCase():undefined;
  return {origin:"transport_close",closeCode:code,closeReason:value!==undefined&&Object.hasOwn(closeReasons,value)?closeReasons[value]:"unrecognized",
    ...(bytes&&bytes.length<=123?{closeReasonBytes:bytes.length}:{}),
    ...(value?{closeReasonSignals:reasonSignals.filter(([,pattern])=>pattern.test(value)).map(([label])=>label)}:{})};
}
export function streamingAsrTransportContext(error:unknown):StreamingAsrFailureContext {
  return {origin:"transport_error",transportErrorCode:object(error)?error.code:undefined};
}
export function isStreamingAsrFailureEvent(event:unknown):event is Record<string,unknown> {
  return object(event)&&["error","conversation.item.input_audio_transcription.failed"].includes(event.type as string);
}
export function streamingAsrProviderContext(event:Record<string,unknown>):StreamingAsrFailureContext {
  const error=object(event.error)?event.error:{};
  return {origin:"provider_error",providerErrorCode:safe(providerCodes,error.code),providerErrorType:safe(providerTypes,error.type),
    ...(typeof error.message==="string"&&error.message.length<=4096?{
      providerMessageSignals:reasonSignals.filter(([,pattern])=>pattern.test(error.message as string)).map(([label])=>label)}:{}),
    ...(error.param!==undefined&&error.param!==null?{providerErrorParam:safe(providerParams,error.param)}:{})};
}
const wireTypes=new Set([
  "session.created","session.updated","session.finished","error",
  "input_audio_buffer.speech_started","input_audio_buffer.speech_stopped",
  "input_audio_buffer.committed","conversation.item.created",
  "conversation.item.input_audio_transcription.text",
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
  "conversation.item.input_audio_transcription.failed",
]);
const languageClasses=new Set<unknown>(["missing","null","code","other_string","non_string"]);
export function streamingAsrProtocolContext(event:Record<string,unknown>):StreamingAsrFailureContext {
  if(!["conversation.item.input_audio_transcription.text","conversation.item.input_audio_transcription.completed"].includes(String(event?.type)))return {origin:"protocol"};
  const language=event.language;
  return {origin:"protocol",languageValueClass:language===undefined?"missing":language===null?"null":
    typeof language==="string"?(/^[a-z]{2,3}$/.test(language)?"code":"other_string"):"non_string",
    ...(typeof event.transcript==="string"?{transcriptEmpty:event.transcript.trim().length===0}:{})};
}
export function streamingAsrFailureDiagnostic(code:string,eventType:unknown,uploadedSamples:number,language?:unknown,context?:StreamingAsrFailureContext){
  return {
    code:/^[a-z0-9_]{1,120}$/.test(code)?code:"public_asr_stream_unclassified",
    eventType:typeof eventType==="string"&&wireTypes.has(eventType)?eventType:"unknown",
    uploadedSamples:Number.isSafeInteger(uploadedSamples)&&uploadedSamples>=0?uploadedSamples:0,
    ...(typeof language==="string"&&/^[a-z]{2,3}$/.test(language)?{language}:{}),
    ...(context?{origin:origins.has(context.origin)?context.origin:"operation"}:{}),
    ...(context&&Number.isInteger(context.closeCode)&&((Number(context.closeCode)>=1000&&Number(context.closeCode)<=1015)||
      (Number(context.closeCode)>=3000&&Number(context.closeCode)<=4999))?{closeCode:Number(context.closeCode)}:{}),
    ...(context?.closeReason!==undefined?{closeReason:safe(closeLabels,context.closeReason)}:{}),
    ...(context&&Number.isInteger(context.closeReasonBytes)&&Number(context.closeReasonBytes)>=0&&Number(context.closeReasonBytes)<=123?{closeReasonBytes:Number(context.closeReasonBytes)}:{}),
    ...(context?.providerErrorCode!==undefined?{providerErrorCode:safe(providerCodes,context.providerErrorCode)}:{}),
    ...(context?.providerErrorType!==undefined?{providerErrorType:safe(providerTypes,context.providerErrorType)}:{}),
    ...(context?.providerErrorParam!==undefined?{providerErrorParam:safe(providerParams,context.providerErrorParam)}:{}),
    ...(typeof context?.providerTaskId==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(context.providerTaskId)?{providerTaskId:context.providerTaskId}:{}),
    ...(Array.isArray(context?.providerMessageSignals)?{providerMessageSignals:[...new Set(context.providerMessageSignals.filter(v=>typeof v==="string"&&signalLabels.has(v)))]}:{}),
    ...(context?.transportErrorCode!==undefined?{transportErrorCode:safe(transportCodes,context.transportErrorCode)}:{}),
    ...(context?.languageValueClass!==undefined?{languageValueClass:safe(languageClasses,context.languageValueClass)}:{}),
    ...(typeof context?.transcriptEmpty==="boolean"?{transcriptEmpty:context.transcriptEmpty}:{}),
    ...(context?.protocol?{protocol:sanitizeQwenProtocolDiagnostic(context.protocol)}:{}),
    ...(Array.isArray(context?.closeReasonSignals)?{closeReasonSignals:[...new Set(context.closeReasonSignals.filter(v=>typeof v==="string"&&signalLabels.has(v)))]}:{}),
  };
}
