import {createHash,createHmac,randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {PublicModelAttemptEvent,RealtimeExecutionPlan,RealtimeProcessingAuthorization} from "@translation/contracts";
import {parseRealtimeProcessingRequest} from "@translation/contracts";
import {LmStudioClient,type LmStudioClientOptions} from "./lmstudio-client.js";
import {PublicTranslationError,abortable} from "./lmstudio-public-protocol.js";
import type {TranslationClient} from "./lmstudio-realtime-provider-options.js";

/** Structural projection of the API's credential-free session snapshot. This is
 * internal wiring, not a new public HTTP contract or authority to run models. */
export interface ConfiguredPublicTranslationOptions {
  snapshot:{deploymentId:string;configurationRevision:number;configurationHash:string;modelPolicyRevision:string;
    executionPlan:RealtimeExecutionPlan;components:{translation?:{enabled:boolean;vendor:string;protocol:string;authKind:string;
      endpoint:string;modelId:string;timeoutMs:number;maxTokens:number;region?:string;projectId?:string;location?:string}}};
  deploymentId:string;authorization:RealtimeProcessingAuthorization;
  attemptRecorder:NonNullable<LmStudioClientOptions["attemptRecorder"]>;
  // Must resolve the exact bound snapshot afresh, never a global/private key.
  resolveCredentials:(signal?:AbortSignal)=>Promise<TranslationCredentials>|TranslationCredentials;
  fetchFn?:typeof fetch;
}
export interface TranslationCredentials {apiKey?:string;secretId?:string;secretKey?:string;accessToken?:string;accessTokenExpiresAt?:number;quotaProjectId?:string;}
const protocols:Record<string,string>={qwen:"qwen_chat",tencent:"tencent_hunyuan_chat",openai:"openai_chat"};
const tmtLanguages=new Set(["zh","en","ja","ko","de","fr","es","it","pt","ru","vi","id","ms","th","tr"]);
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const hmac=(key:string|Buffer,value:string)=>createHmac("sha256",key).update(value).digest();
const secretId=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,240}$/.test(value);
const secretKey=(value:unknown):value is string=>typeof value==="string"&&value.length>0&&value.length<=4096&&value.trim()===value&&!/[\u0000-\u001f\u007f]/u.test(value);

function tmtRequest(profile:NonNullable<ConfiguredPublicTranslationOptions["snapshot"]["components"]["translation"]>,credentials:TranslationCredentials,input:{text:string;sourceLanguage:string;targetLanguage:string},timestamp:number){
  const region=profile.region;
  if(!secretId(credentials.secretId)||!secretKey(credentials.secretKey)||!tmtLanguages.has(input.sourceLanguage)||!tmtLanguages.has(input.targetLanguage)||input.sourceLanguage===input.targetLanguage||
    typeof region!=="string"||!/^[a-z]{2}(?:-[a-z]+)?$/.test(region)||!Number.isFinite(timestamp))throw new PublicTranslationError("tencent_tmt_configuration","not_sent");
  let url:URL;try{url=new URL(profile.endpoint);}catch{throw new PublicTranslationError("tencent_tmt_configuration","not_sent");}
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw new PublicTranslationError("tencent_tmt_configuration","not_sent");
  const body=JSON.stringify({SourceText:input.text,Source:input.sourceLanguage,Target:input.targetLanguage,ProjectId:0});
  const action="TextTranslate",version="2018-03-21",service="tmt",date=new Date(timestamp*1000).toISOString().slice(0,10),payloadHash=hash(body);
  const headers:{[key:string]:string}={"content-type":"application/json; charset=utf-8",host:url.host,"x-tc-action":action.toLowerCase(),"x-tc-region":region,"x-tc-timestamp":String(timestamp),"x-tc-version":version};
  const names=Object.keys(headers).sort(),canonicalHeaders=names.map(name=>`${name}:${headers[name]}\n`).join(""),signedHeaders=names.join(";");
  const canonical=`POST\n${url.pathname}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`,scope=`${date}/${service}/tc3_request`,string=`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`;
  const signing=hmac(hmac(hmac(hmac(`TC3${credentials.secretKey}`,date),service),"tc3_request"),string).toString("hex");
  return {url:url.toString(),body,headers:{"content-type":headers["content-type"],"x-tc-action":action,"x-tc-region":region,"x-tc-timestamp":String(timestamp),"x-tc-version":version,authorization:`TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signing}`}};
}

async function tmtTranslate(profile:NonNullable<ConfiguredPublicTranslationOptions["snapshot"]["components"]["translation"]>,credentials:TranslationCredentials,input:Parameters<TranslationClient["translate"]>[0],journal:ConfiguredPublicTranslationOptions["attemptRecorder"],fetchFn:typeof fetch|undefined,signal:AbortSignal){
  if(!input.attemptContext||!journal)throw new PublicTranslationError("public_attempt_configuration","not_sent");
  const request=tmtRequest(profile,credentials,input,Math.floor(Date.now()/1000));
  const attempt:PublicModelAttemptEvent={sessionId:journal.sessionId,leaseId:journal.leaseId,providerId:"tencent",modelId:"service:tencent_tmt",attemptId:randomUUID(),segmentId:input.attemptContext.segmentId,revision:input.attemptContext.revision,component:"translation",state:"dispatching"};
  const record=async(event:PublicModelAttemptEvent)=>{try{await abortable(journal.record(structuredClone(event)),signal);}catch{throw new PublicTranslationError("public_attempt_record_failed","not_sent");}};
  let prepared=false,terminal=false,sent=false;
  try{
    await record(attempt);prepared=true;
    const response=await abortable((fetchFn??fetch)(request.url,{method:"POST",redirect:"error",signal,headers:request.headers,body:request.body}),signal);sent=true;
    const metadata={requestId:response.headers.get("x-tc-requestid")??undefined};
    if(!response.ok)throw new PublicTranslationError(response.status===429?"public_translation_rate_limited":"public_translation_http_error",response.status>=500||response.status===408?"uncertain":"rejected",response.status,metadata);
    const value=await response.json() as {Response?:{TargetText?:unknown;RequestId?:unknown;Error?:{Code?:unknown}}};
    const responseBody=value?.Response,requestId=typeof responseBody?.RequestId==="string"&&/^[A-Za-z0-9_.:/-]{1,240}$/.test(responseBody.RequestId)?responseBody.RequestId:metadata.requestId;
    if(responseBody?.Error||typeof responseBody?.TargetText!=="string"||!responseBody.TargetText.trim())throw new PublicTranslationError("tencent_tmt_invalid_response","uncertain",undefined,{requestId});
    terminal=true;await record({...attempt,state:"confirmed",metadata:{requestId}});return responseBody.TargetText.trim();
  }catch(error){
    const failure=error instanceof PublicTranslationError?error:new PublicTranslationError(signal.aborted?"public_translation_cancelled":"public_translation_transport_or_payload_error",sent?"uncertain":"not_sent");
    if(prepared&&!terminal){terminal=true;await record({...attempt,state:failure.outcome,failureCode:failure.code,...(failure.metadata?{metadata:failure.metadata}:{})});}
    throw failure;
  }
}

/** One session-owned client, injected into the original LmStudioRealtimeProvider.
 * Does not enable Gateway admission or invent ASR/TTS/qualification fallbacks. */
export function configuredPublicTranslation(options:ConfiguredPublicTranslationOptions):TranslationClient {
  const snapshot=structuredClone(options.snapshot),authorization=structuredClone(options.authorization);
  const parsed=parseRealtimeProcessingRequest({contractVersion:authorization.contractVersion,processingMode:authorization.processingMode,
    modelPolicyRevision:authorization.modelPolicyRevision,languagePolicy:authorization.languagePolicy,executionPlan:authorization.executionPlan,syncRequested:false});
  const profile=snapshot.components.translation,recorder=options.attemptRecorder;
  const google=profile?.vendor==="google"&&(profile.protocol==="google_gemini"||profile.protocol==="google_vertex_gemini");
  const vertex=google&&profile.protocol==="google_vertex_gemini";
  const tmt=profile?.vendor==="tencent"&&profile.protocol==="tencent_tmt";
  if(snapshot.deploymentId!==options.deploymentId||!Number.isSafeInteger(snapshot.configurationRevision)||snapshot.configurationRevision<1||
    !/^[a-f0-9]{64}$/.test(snapshot.configurationHash)||parsed.status!=="valid"||authorization.processingMode!=="online"||authorization.contractVersion!==1||
    authorization.modelPolicyRevision!==snapshot.modelPolicyRevision||!isDeepStrictEqual(authorization.executionPlan,snapshot.executionPlan)||
    snapshot.executionPlan.asr.execution!=="public"||snapshot.executionPlan.translation.execution!=="public"||
    !["public","disabled"].includes(snapshot.executionPlan.tts.execution)||!profile?.enabled||
    !(tmt?profile.authKind==="tencent_secret":vertex?["google_service_account","google_adc"].includes(profile.authKind):profile.authKind==="api_key")){
    throw new PublicTranslationError("public_translation_binding_invalid","not_sent");
  }
  if(!google&&!tmt&&(!Object.hasOwn(protocols,profile.vendor)||protocols[profile.vendor]!==profile.protocol)){
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
        language.source==="auto"?language.pair?.some(code=>code===input.sourceLanguage)&&
          language.pair.some(code=>code===input.targetLanguage)&&input.sourceLanguage!==input.targetLanguage:
          language.source===input.sourceLanguage&&language.target===input.targetLanguage;
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
        if(tmt){clearTimeout(timer);return await tmtTranslate(profile,credentials,input,journal,fetchFn,controller.signal);}
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
