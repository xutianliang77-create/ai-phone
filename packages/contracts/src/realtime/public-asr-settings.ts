/** Optional provider settings belong to the signed configuration snapshot.
 * Omitted legacy settings keep their original identity and effective defaults. */
export interface PublicAsrServerVad { threshold:number; silenceDurationMs:number; }
export interface PublicAsrStreamingSettings {semanticPunctuation:boolean;heartbeat:boolean;}
export function resolvePublicAsrStreamingSettings(protocol:string,value?:unknown):PublicAsrStreamingSettings|undefined {
  if(protocol!=='qwen_audio_streaming'){
    if(value!==undefined)throw Error('unsupported_streaming_settings');return;
  }
  if(value===undefined)return {semanticPunctuation:true,heartbeat:true};
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_streaming_settings');
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==2||typeof v.semanticPunctuation!=='boolean'||typeof v.heartbeat!=='boolean')throw Error('invalid_streaming_settings');
  return {semanticPunctuation:v.semanticPunctuation,heartbeat:v.heartbeat};
}
export function publicAsrServerVadCapability(protocol:string) {
  return protocol === "qwen_asr_realtime" ? {
    type:"server_vad" as const,
    threshold:{min:-1,max:1,default:0.2},
    silenceDurationMs:{min:200,max:6000,default:400},
  } : undefined;
}
export function resolvePublicAsrServerVad(protocol:string,value?:unknown):PublicAsrServerVad|undefined {
  const capability=publicAsrServerVadCapability(protocol);
  if(value===undefined)return capability?{threshold:capability.threshold.default,silenceDurationMs:capability.silenceDurationMs.default}:undefined;
  if(!capability||!value||typeof value!=="object"||Array.isArray(value))throw Error("invalid_server_vad");
  const v=value as Record<string,unknown>;
  if(Object.keys(v).length!==2||!Object.hasOwn(v,"threshold")||!Object.hasOwn(v,"silenceDurationMs")||
    typeof v.threshold!=="number"||!Number.isFinite(v.threshold)||v.threshold<capability.threshold.min||v.threshold>capability.threshold.max||
    !Number.isSafeInteger(v.silenceDurationMs)||Number(v.silenceDurationMs)<capability.silenceDurationMs.min||Number(v.silenceDurationMs)>capability.silenceDurationMs.max)throw Error("invalid_server_vad");
  return {threshold:v.threshold,silenceDurationMs:Number(v.silenceDurationMs)};
}
