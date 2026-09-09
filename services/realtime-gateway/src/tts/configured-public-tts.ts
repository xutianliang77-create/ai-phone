import {isDeepStrictEqual} from "node:util";
import {parseRealtimeProcessingRequest,type RealtimeExecutionPlan,type RealtimeProcessingAuthorization} from "@translation/contracts";
import {HttpTtsSynthesizer} from "./http-tts-synthesizer.js";
import {PublicSpeechError,type PublicSpeechOptions} from "./public-speech.js";
export interface ConfiguredPublicTtsOptions {
  deploymentId:string;sessionId:string;leaseId:string;authorization:RealtimeProcessingAuthorization;
  snapshot:{deploymentId:string;configurationRevision:number;configurationHash:string;modelPolicyRevision:string;executionPlan:RealtimeExecutionPlan;
    components:{tts?:{enabled:boolean;vendor:string;protocol:string;authKind:string;endpoint:string;modelId:string;voice:string;timeoutMs:number;sampleRate:16000|24000;appId?:string;projectId?:string}}};
  prefillMs:number;resolveCredentials:PublicSpeechOptions["resolveCredentials"];record:PublicSpeechOptions["record"];fetchFn?:typeof fetch;socketFactory?:PublicSpeechOptions["socketFactory"];
}
/** Internal component only; exact snapshot credentials and recorded TTS qualification
 * must be checked by the supplied server resolver/journal. Never a health probe. */
export function configuredPublicTts(options:ConfiguredPublicTtsOptions) {
  const snapshot=structuredClone(options.snapshot),authorization=structuredClone(options.authorization),profile=snapshot.components.tts;
  const parsed=parseRealtimeProcessingRequest({contractVersion:authorization.contractVersion,processingMode:authorization.processingMode,
    modelPolicyRevision:authorization.modelPolicyRevision,languagePolicy:authorization.languagePolicy,executionPlan:authorization.executionPlan,syncRequested:false});
  if(parsed.status!=="valid"||authorization.processingMode!=="online"||snapshot.deploymentId!==options.deploymentId||
    !Number.isSafeInteger(snapshot.configurationRevision)||snapshot.configurationRevision<1||!/^[a-f0-9]{64}$/.test(snapshot.configurationHash)||
    snapshot.modelPolicyRevision!==authorization.modelPolicyRevision||!isDeepStrictEqual(snapshot.executionPlan,authorization.executionPlan)||
    authorization.executionPlan.tts.execution!=="public"||!profile?.enabled||
    !(profile.vendor==="openai"&&profile.protocol==="openai_speech"||profile.vendor==="qwen"&&profile.protocol==="qwen_tts_realtime"||profile.vendor==="tencent"&&profile.protocol==="tencent_tts_ws"||profile.vendor==="google"&&profile.protocol==="google_cloud_tts")||
    (profile.vendor==="google"?!["google_service_account","google_adc"].includes(profile.authKind):profile.authKind!==(profile.vendor==="tencent"?"tencent_secret":"api_key"))||
    (["tencent","google"].includes(profile.vendor)?![16000,24000].includes(profile.sampleRate):profile.sampleRate!==24000))throw new PublicSpeechError("public_tts_configuration_not_supported","not_sent");
  if(authorization.languagePolicy.autoReverse||authorization.languagePolicy.source==="auto")throw new PublicSpeechError("public_tts_dynamic_language_not_implemented","not_sent");
  const speech:PublicSpeechOptions={sessionId:options.sessionId,leaseId:options.leaseId,endpoint:profile.endpoint,modelId:profile.modelId,voice:profile.voice,
    timeoutMs:profile.timeoutMs,prefillMs:options.prefillMs,targetLanguage:authorization.languagePolicy.target,
    resolveCredentials:options.resolveCredentials,record:options.record,fetchFn:options.fetchFn,
    protocol:profile.protocol as PublicSpeechOptions["protocol"],socketFactory:options.socketFactory,appId:profile.appId,projectId:profile.projectId,sampleRate:profile.sampleRate};
  return new HttpTtsSynthesizer({ttsHttpTimeoutMs:profile.timeoutMs,ttsStreamPrefillMs:options.prefillMs},speech);
}
