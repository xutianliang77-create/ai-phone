import {isDeepStrictEqual} from "node:util";
import type {RealtimeExecutionPlan,RealtimeProcessingAuthorization} from "@translation/contracts";
import {parseRealtimeProcessingRequest} from "@translation/contracts";
import {LmStudioClient,type LmStudioClientOptions} from "./lmstudio-client.js";
import {PublicTranslationError,abortable} from "./lmstudio-public-protocol.js";
import type {TranslationClient} from "./lmstudio-realtime-provider-options.js";

/** Structural projection of the API's credential-free session snapshot. This is
 * internal wiring, not a new public HTTP contract or authority to run models. */
export interface ConfiguredPublicTranslationOptions {
  snapshot:{deploymentId:string;configurationRevision:number;configurationHash:string;modelPolicyRevision:string;
    executionPlan:RealtimeExecutionPlan;components:{translation?:{enabled:boolean;vendor:string;protocol:string;authKind:string;
      endpoint:string;modelId:string;timeoutMs:number;maxTokens:number;projectId?:string;location?:string}}};
  deploymentId:string;authorization:RealtimeProcessingAuthorization;
  attemptRecorder:NonNullable<LmStudioClientOptions["attemptRecorder"]>;
  // Must resolve the exact bound snapshot afresh, never a global/private key.
  resolveCredentials:(signal?:AbortSignal)=>Promise<TranslationCredentials>|TranslationCredentials;
  fetchFn?:typeof fetch;
}
export interface TranslationCredentials {apiKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string;}
const protocols:Record<string,string>={qwen:"qwen_chat",tencent:"tencent_hunyuan_chat",openai:"openai_chat"};

/** One session-owned client, injected into the original LmStudioRealtimeProvider.
 * Does not enable Gateway admission or invent ASR/TTS/qualification fallbacks. */
export function configuredPublicTranslation(options:ConfiguredPublicTranslationOptions):TranslationClient {
  const snapshot=structuredClone(options.snapshot),authorization=structuredClone(options.authorization);
  const parsed=parseRealtimeProcessingRequest({contractVersion:authorization.contractVersion,processingMode:authorization.processingMode,
    modelPolicyRevision:authorization.modelPolicyRevision,languagePolicy:authorization.languagePolicy,executionPlan:authorization.executionPlan,syncRequested:false});
  const profile=snapshot.components.translation,recorder=options.attemptRecorder;
  const google=profile?.vendor==="google"&&(profile.protocol==="google_gemini"||profile.protocol==="google_vertex_gemini");
  const vertex=google&&profile.protocol==="google_vertex_gemini";
  if(snapshot.deploymentId!==options.deploymentId||!Number.isSafeInteger(snapshot.configurationRevision)||snapshot.configurationRevision<1||
    !/^[a-f0-9]{64}$/.test(snapshot.configurationHash)||parsed.status!=="valid"||authorization.processingMode!=="online"||authorization.contractVersion!==1||
    authorization.modelPolicyRevision!==snapshot.modelPolicyRevision||!isDeepStrictEqual(authorization.executionPlan,snapshot.executionPlan)||
    snapshot.executionPlan.asr.execution!=="public"||snapshot.executionPlan.translation.execution!=="public"||
    !["public","disabled"].includes(snapshot.executionPlan.tts.execution)||!profile?.enabled||
    !(vertex?["google_service_account","google_adc"].includes(profile.authKind):profile.authKind==="api_key")){
    throw new PublicTranslationError("public_translation_binding_invalid","not_sent");
  }
  if(!google&&(!Object.hasOwn(protocols,profile.vendor)||protocols[profile.vendor]!==profile.protocol)){
    throw new PublicTranslationError("public_translation_protocol_not_implemented","not_sent");
  }
  if(!recorder||recorder.providerId!==profile.vendor||typeof recorder.record!=="function"||
    ![recorder.sessionId,recorder.leaseId].every(v=>typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=240)||
    typeof options.resolveCredentials!=="function"||!Number.isSafeInteger(profile.timeoutMs)||profile.timeoutMs<250||profile.timeoutMs>120000){
    throw new PublicTranslationError("public_translation_binding_invalid","not_sent");
  }
  // Copy IDs/functions: mutation of an options object must not switch sessions.
  const journal={...recorder},resolve=options.resolveCredentials,fetchFn=options.fetchFn;
  return {supportsAbort:true,supportsAttemptContext:true,healthCheck:async()=>false,
    async translate(input){
      if(input.signal?.aborted)throw new PublicTranslationError("public_translation_cancelled","not_sent");
      const language=authorization.languagePolicy;
      const pairMatches=language.autoReverse?language.pair?.some(code=>code===input.sourceLanguage)&&language.pair.some(code=>code===input.targetLanguage)&&input.sourceLanguage!==input.targetLanguage:
        (language.source==="auto"||language.source===input.sourceLanguage)&&language.target===input.targetLanguage;
      if(!pairMatches)throw new PublicTranslationError("public_translation_language_scope_mismatch","not_sent");
      const controller=new AbortController(),cancel=()=>controller.abort();
      input.signal?.addEventListener("abort",cancel,{once:true});
      const deadline=Date.now()+profile.timeoutMs,timer=setTimeout(cancel,profile.timeoutMs);
      try{
        let credentials:TranslationCredentials;
        try{credentials=await abortable(Promise.resolve().then(()=>resolve(controller.signal)),controller.signal);}
        catch{throw new PublicTranslationError(controller.signal.aborted?(input.signal?.aborted?"public_translation_cancelled":"public_translation_timeout"):
          "public_translation_credentials_unavailable","not_sent");}
        if(controller.signal.aborted)throw new PublicTranslationError("public_translation_cancelled","not_sent");
        const token=vertex?credentials?.accessToken:credentials?.apiKey;
        if(typeof token!=="string"||!token.trim()||token.trim()!==token||/[\r\n]/.test(token)||
          vertex&&(!Number.isFinite(credentials.accessTokenExpiresAt)||Number(credentials.accessTokenExpiresAt)<=deadline)){
          throw new PublicTranslationError("public_translation_credentials_unavailable","not_sent");
        }
        clearTimeout(timer);
        const remainingMs=deadline-Date.now();
        if(remainingMs<=0)throw new PublicTranslationError("public_translation_timeout","not_sent");
        const client=new LmStudioClient({baseUrl:profile.endpoint,model:profile.modelId,apiKey:vertex?undefined:token,
          timeoutMs:remainingMs,maxTokens:profile.maxTokens,transportProfile:google?"public_google":"public_compatible",
          ...(google?{google:{protocol:vertex?"vertex" as const:"gemini" as const,projectId:profile.projectId,location:profile.location,...(vertex?{accessToken:token,quotaProjectId:credentials.quotaProjectId}:{})}}:{}),
          reasoningEffort:null,...(profile.vendor==="qwen"?{extraBody:{enable_thinking:false}}:{}),attemptRecorder:journal,fetchFn});
        return await client.translate({...input,signal:controller.signal});
      }finally{clearTimeout(timer);input.signal?.removeEventListener("abort",cancel);}
    }};
}
