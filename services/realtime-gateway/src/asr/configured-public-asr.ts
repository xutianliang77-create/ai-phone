import {isDeepStrictEqual} from "node:util";
import {publicProtocolSampleRateSupported} from "@translation/contracts";
import {parseRealtimeProcessingRequest,type RealtimeExecutionPlan,type RealtimeProcessingAuthorization} from "@translation/contracts";
import {HttpAsrClient} from "./http-asr-client.js";
import {PublicAsrError,type CompletedAsrAudio,type CompletedAsrOptions} from "./public-asr-completed-audio.js";
import {HttpAsrProvider} from "./http-asr-provider.js";
import {OpenAiStreamingAsrClient,type StreamingAsrOptions} from "./openai-streaming-asr-client.js";
import {qwenAsrLanguage} from "./qwen-streaming-asr-protocol.js";
import {validateTencentAsr} from "./tencent-streaming-asr.js";
import {googleAsrConfiguration} from "./google-streaming-asr.js";
export interface ConfiguredPublicAsrOptions {
  deploymentId:string;authorization:RealtimeProcessingAuthorization;
  snapshot:{deploymentId:string;configurationRevision:number;modelPolicyRevision:string;executionPlan:RealtimeExecutionPlan;components:{asr?:{
    enabled:boolean;vendor:string;protocol:string;authKind:string;endpoint:string;modelId:string;timeoutMs:number;sampleRate:16000|24000;appId?:string;projectId?:string;location?:string;recognizer?:string;languageLocales?:Record<string,string>}}};
  sessionId:string;leaseId:string;resolveCredentials:StreamingAsrOptions["resolveCredentials"];record:CompletedAsrOptions["record"];fetchFn?:typeof fetch;
}
/** Explicit finalized-turn API, NOT a replacement for streaming AsrProvider.transcribe(frame). */
export function configuredPublicAsr(options:ConfiguredPublicAsrOptions){
  const protocol=options.snapshot.components.asr?.protocol==="qwen_asr_compatible"?"qwen_asr_compatible":"openai_transcriptions";
  const {authorization,profile}=validateConfiguredAsr(options,protocol);
  if(protocol==="qwen_asr_compatible")qwenAsrLanguage(authorization.languagePolicy.source);
  if(!publicProtocolSampleRateSupported(protocol,profile.sampleRate))throw new PublicAsrError("public_asr_configuration_not_supported","not_sent");
  const client=new HttpAsrClient({endpoint:profile.endpoint,timeoutMs:profile.timeoutMs,fetchFn:options.fetchFn});
  const binding:CompletedAsrOptions={sessionId:options.sessionId,leaseId:options.leaseId,model:profile.modelId,sampleRate:profile.sampleRate,wireProfile:protocol,resolveCredentials:options.resolveCredentials,record:options.record};
  return {healthCheck:async()=>false,async transcribeCompletedAudio(input:CompletedAsrAudio,signal?:AbortSignal){
    if(input.sourceLanguage!==authorization.languagePolicy.source)throw new PublicAsrError("public_asr_language_scope_mismatch","not_sent");
    return client.transcribeCompletedAudio(input,binding,signal);
  }};
}
function validateConfiguredAsr(options:ConfiguredPublicAsrOptions,protocol:string){
  const snapshot=structuredClone(options.snapshot),authorization=structuredClone(options.authorization),profile=snapshot.components.asr;
  const parsed=parseRealtimeProcessingRequest({contractVersion:authorization.contractVersion,processingMode:authorization.processingMode,modelPolicyRevision:authorization.modelPolicyRevision,
    languagePolicy:authorization.languagePolicy,executionPlan:authorization.executionPlan,syncRequested:false});
  if(parsed.status!=="valid"||authorization.processingMode!=="online"||snapshot.deploymentId!==options.deploymentId||!Number.isSafeInteger(snapshot.configurationRevision)||snapshot.configurationRevision<1||
    snapshot.modelPolicyRevision!==authorization.modelPolicyRevision||!isDeepStrictEqual(snapshot.executionPlan,authorization.executionPlan)||!profile?.enabled||
    profile.vendor!==(protocol==="qwen_asr_realtime"||protocol==="qwen_asr_compatible"?"qwen":protocol==="tencent_asr_ws"?"tencent":protocol==="google_speech_v2"?"google":"openai")||profile.protocol!==protocol||
    (protocol==="google_speech_v2"?!["google_service_account","google_adc"].includes(profile.authKind):profile.authKind!==(protocol==="tencent_asr_ws"?"tencent_secret":"api_key"))||typeof options.record!=="function"||typeof options.resolveCredentials!=="function")throw new PublicAsrError("public_asr_configuration_not_supported","not_sent");
  if(authorization.languagePolicy.source==="auto"||authorization.languagePolicy.autoReverse)throw new PublicAsrError("public_asr_language_detection_not_implemented","not_sent");
  return {snapshot,authorization,profile};
}
export type ConfiguredStreamingAsrOptions=ConfiguredPublicAsrOptions&Pick<StreamingAsrOptions,"authorizeConnection"|"socketFactory"|"googleStreamFactory">;
export function configuredStreamingAsr(options:ConfiguredStreamingAsrOptions){
  const configured=options.snapshot.components.asr?.protocol;
  const protocol=configured==="google_speech_v2"?"google_speech_v2":configured==="qwen_asr_realtime"?"qwen_asr_realtime":configured==="tencent_asr_ws"?"tencent_asr_ws":"openai_realtime_asr";
  const {profile,authorization}=validateConfiguredAsr(options,protocol),qwen=protocol==="qwen_asr_realtime",tencent=protocol==="tencent_asr_ws",google=protocol==="google_speech_v2";
  if(qwen)qwenAsrLanguage(authorization.languagePolicy.source);
  if(tencent)validateTencentAsr({endpoint:profile.endpoint,model:profile.modelId,appId:profile.appId,language:authorization.languagePolicy.source as StreamingAsrOptions["language"]});
  let url:URL;try{url=new URL(profile.endpoint);}catch{throw new PublicAsrError("public_asr_stream_configuration","not_sent");}
  if(url.protocol!==(google?"https:":"wss:")||url.username||url.password||url.search||url.hash||!publicProtocolSampleRateSupported(protocol,profile.sampleRate)||
    !google&&!tencent&&!(qwen?/^[a-z]{2,3}$/:/^[a-z]{2}$/).test(authorization.languagePolicy.source)||!Number.isSafeInteger(profile.timeoutMs)||profile.timeoutMs<250||profile.timeoutMs>120000||
    ![options.sessionId,options.leaseId,profile.modelId].every(v=>typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=240)||typeof options.authorizeConnection!=="function"){
    throw new PublicAsrError("public_asr_stream_configuration","not_sent");
  }
  const clientOptions:StreamingAsrOptions={sessionId:options.sessionId,leaseId:options.leaseId,
    endpoint:profile.endpoint,model:profile.modelId,language:authorization.languagePolicy.source as StreamingAsrOptions["language"],timeoutMs:profile.timeoutMs,wireProfile:protocol,appId:profile.appId,
    authorizeConnection:options.authorizeConnection,resolveCredentials:options.resolveCredentials,record:options.record,socketFactory:options.socketFactory,
    projectId:profile.projectId,location:profile.location,recognizer:profile.recognizer,languageLocales:profile.languageLocales,sampleRate:profile.sampleRate,googleStreamFactory:options.googleStreamFactory};
  if(google)googleAsrConfiguration(clientOptions);
  return new HttpAsrProvider({endpoint:profile.endpoint,timeoutMs:profile.timeoutMs,client:new OpenAiStreamingAsrClient(clientOptions)});
}
