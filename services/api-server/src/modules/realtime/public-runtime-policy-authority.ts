import {createHmac,timingSafeEqual} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute,resolve} from "node:path";
import {isSupportedLanguage,isTranslationLanguage,publicModelComponents,publicProtocolAutomaticLanguageSupported} from "@translation/contracts";
import { inspectPublicRuntimeLiveQualification } from "@translation/platform-security";
import {canonicalSyncJson,syncKey} from "../sessions/session-result-sync-contract.js";
import type {PublicInferenceEvidence} from "../sessions/public-inference-evidence.js";
import type {PublicModelRuntimeSnapshot} from "../models/public-model-runtime-config.js";
import type {PublicRealtimeAuthority,PublicRealtimeConfigurationCapability} from "./public-realtime-coordinator.js";

type RuntimeEnv=Partial<Pick<NodeJS.ProcessEnv,"NODE_ENV"|"PUBLIC_RUNTIME_ENABLED"|"PUBLIC_RUNTIME_ADMISSION_POLICY_FILE"|"PUBLIC_RUNTIME_ADMISSION_POLICY_KEY"|"API_RESULT_SYNC_DEPLOYMENT_ID"|"PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION"|"PUBLIC_RUNTIME_QUALIFICATION_BOOTSTRAP"|"PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE"|"PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY">>;
type ProviderAvailability={providerId:string;state:"available"|"unavailable"};
type QualifiedLanguagePair={source:string;target:string};
type Policy={schemaVersion:1;policyId:string;deploymentId:string;configurationHash:string;modelPolicyRevision:string;region:string;
  issuedAt:string;expiresAt:string;maxActiveSeconds?:number;currency:string;reservedMicros:number;qualifiedComponents:Array<"asr"|"translation"|"tts">;
  /** Server-global provider snapshot. It is never a user balance or a client field. */
  providerAvailability:ProviderAvailability[];
  /** Explicit language directions qualified for this exact configuration. */
  qualifiedLanguagePairs:QualifiedLanguagePair[];
  /** Optional for existing signed schema-1 policy documents. Missing is false. */
  automaticLanguage?:boolean;automaticReverse?:boolean;signature:string;};
type PolicyBundle={schemaVersion:2;policies:Policy[]};
const enabled=(value:unknown)=>typeof value==="string"&&value.trim().toLowerCase()==="true";
const hex=(value:unknown,length:number)=>typeof value==="string"&&new RegExp(`^[a-f0-9]{${length}}$`,"i").test(value);
const policyFields=["schemaVersion","policyId","deploymentId","configurationHash","modelPolicyRevision","region","issuedAt","expiresAt","maxActiveSeconds","currency","reservedMicros","qualifiedComponents","providerAvailability","qualifiedLanguagePairs","automaticLanguage","automaticReverse","signature"];
const policyBundleFields=["schemaVersion","policies"];
const body=(policy:Policy)=>Object.fromEntries(Object.entries(policy).filter(([key])=>key!=="signature"));

/** Signs the operator policy body; callers own storage and never receive model credentials. */
export function signPublicRuntimeAdmissionPolicy(policy:Omit<Policy,"signature">,key:string){
  if(!hex(key,64))throw Error("public_runtime_admission_policy_key_invalid");
  return createHmac("sha256",key).update(canonicalSyncJson(policy)).digest("hex");
}

/** Default deny. A signed policy binds configuration-qualified components and
 * fixed language pairs to a server-global provider-availability snapshot. It
 * never probes a provider, turns a provider quota into a user balance, or
 * exposes either internal qualification input. */
export function publicRealtimeAuthorityFromEnvironment(env:RuntimeEnv=process.env):PublicRealtimeAuthority|undefined{
  if(!enabled(env.PUBLIC_RUNTIME_ENABLED))return undefined;
  const file=env.PUBLIC_RUNTIME_ADMISSION_POLICY_FILE,key=env.PUBLIC_RUNTIME_ADMISSION_POLICY_KEY,deployment=env.API_RESULT_SYNC_DEPLOYMENT_ID;
  if(typeof file!=="string"||!isAbsolute(file)||!hex(key,64)||!syncKey(deployment))throw Error("public_runtime_admission_policy_not_configured");
  const bootstrap=enabled(env.PUBLIC_RUNTIME_QUALIFICATION_BOOTSTRAP);
  if(bootstrap&&env.NODE_ENV!=="development")throw Error("public_runtime_qualification_bootstrap_not_permitted");
  const required=enabled(env.PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION)&&!bootstrap,liveFile=env.PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE,liveKey=env.PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY;
  if(required&&(!isAbsolute(liveFile??"")||!hex(liveKey,64)))throw Error("public_runtime_live_qualification_not_configured");
  return {timeoutMs:5000,configurationCapability:configuration=>configurationCapability(env,configuration),resolveVerifiedEvidence:async context=>{
    const live=required?requiredLiveQualification(env,context.configuration):undefined;
    return resolvePolicy(file,key!,deployment!,context,live);
  }};
}

/** Projects only the qualified language scope that the current public
 * configuration can admit. It is deliberately fail-closed and does not disclose credentials,
 * provider budgets or qualification provenance to the mobile client. */
function configurationCapability(env:RuntimeEnv,configuration:PublicModelRuntimeSnapshot):PublicRealtimeConfigurationCapability{
  try{
    const file=env.PUBLIC_RUNTIME_ADMISSION_POLICY_FILE,key=env.PUBLIC_RUNTIME_ADMISSION_POLICY_KEY,deployment=env.API_RESULT_SYNC_DEPLOYMENT_ID;
    if(!enabled(env.PUBLIC_RUNTIME_ENABLED)||typeof file!=="string"||!isAbsolute(file)||!hex(key,64)||!syncKey(deployment))throw Error();
    const bootstrap=enabled(env.PUBLIC_RUNTIME_QUALIFICATION_BOOTSTRAP);
    if(bootstrap&&env.NODE_ENV!=="development")throw Error();
    const live=enabled(env.PUBLIC_RUNTIME_REQUIRE_LIVE_QUALIFICATION)&&!bootstrap?requiredLiveQualification(env,configuration):undefined;
    const policy=readPolicy(file,key!,new Date(),configuration);
    if(!policyMatchesConfiguration(policy,deployment!,configuration))throw Error();
    const qualifiedLanguagePairs=qualifiedPairs(policy,live);
    if(!qualifiedLanguagePairs.length)throw Error();
    const automatic=automaticRoutingCapability(policy,configuration,live);
    return {status:"qualified",qualifiedLanguagePairs,automaticLanguage:automatic.language,automaticReverse:automatic.reverse};
  }catch{return {status:"not_qualified",qualifiedLanguagePairs:[],automaticLanguage:false,automaticReverse:false};}
}

function resolvePolicy(file:string,key:string,deployment:string,context:Parameters<PublicRealtimeAuthority["resolveVerifiedEvidence"]>[0],live?:ReturnType<typeof requiredLiveQualification>){
  const config=context.configuration,policy=readPolicy(file,key,new Date(),config),components=publicModelComponents(config.executionPlan);
  if(!policyMatchesConfiguration(policy,deployment,config)||policy.deploymentId!==context.deploymentId)throw Error("public_runtime_admission_policy_scope_mismatch");
  const language=context.languagePolicy;
  if(!languageScopeQualified(language,qualifiedPairs(policy,live),automaticRoutingCapability(policy,config,live))){
    throw Error("public_runtime_admission_policy_language_not_qualified");
  }
  const common={sessionId:context.sessionId,ownerId:context.ownerId,deploymentId:context.deploymentId,processingHash:context.processingHash,region:policy.region,
    providerPolicyRevision:config.modelPolicyRevision,sourceReceiptId:policy.policyId,issuedAt:policy.issuedAt,expiresAt:policy.expiresAt};
  const budget:PublicInferenceEvidence={...common,id:`${policy.policyId}:budget`,kind:"provider_budget",state:"reserved",currency:policy.currency,
    reservedMicros:policy.reservedMicros,...(policy.maxActiveSeconds!==undefined?{maxActiveSeconds:policy.maxActiveSeconds}:{}),sampleRate:config.components.asr!.sampleRate};
  const qualifications=components.map(component=>{const profile=config.components[component]!,execution=config.executionPlan[component];
    if(execution.execution!=="public")throw Error("public_runtime_admission_policy_scope_mismatch");return {...common,id:`${policy.policyId}:qualification:${component}`,
      kind:"model_qualification" as const,state:"qualified" as const,component,scopeKey:execution.scopeKey,providerId:profile.vendor,modelId:profile.modelId||execution.scopeKey};});
  return {records:[budget,...qualifications],refs:{consentReceiptId:"consent",budgetReservationId:budget.id,
    qualificationReceiptIds:Object.fromEntries(qualifications.map(value=>[value.component,value.id]))}};
}

function requiredLiveQualification(env:RuntimeEnv,configuration:PublicModelRuntimeSnapshot){
  const live=inspectPublicRuntimeLiveQualification({file:env.PUBLIC_RUNTIME_LIVE_QUALIFICATION_FILE,signingKey:env.PUBLIC_RUNTIME_LIVE_QUALIFICATION_KEY,
    expectation:{deploymentId:configuration.deploymentId,configurationHash:configuration.configurationHash,modelPolicyRevision:configuration.modelPolicyRevision,
      components:publicModelComponents(configuration.executionPlan)}});
  if(live.status!=="ready")throw Error(live.issue);
  return live.evidence;
}

function qualifiedPairs(policy:Policy,live?:ReturnType<typeof requiredLiveQualification>){
  const pairs=policy.qualifiedLanguagePairs.filter(pair=>!live||live.qualifiedLanguagePairs.some(candidate=>
    candidate.source===pair.source&&candidate.target===pair.target));
  return pairs.map(pair=>({...pair}));
}

function automaticRoutingCapability(policy:Policy,configuration:PublicModelRuntimeSnapshot,live?:ReturnType<typeof requiredLiveQualification>){
  const adapter=publicProtocolAutomaticLanguageSupported(configuration.components.asr?.protocol??"");
  const language=adapter&&policy.automaticLanguage===true&&(!live||live.automaticLanguage===true);
  return {language,reverse:language&&policy.automaticReverse===true&&(!live||live.automaticReverse===true)};
}

function languageScopeQualified(language:{source:string;target:string;autoReverse:boolean;pair?:readonly [string,string]},pairs:QualifiedLanguagePair[],automatic:{language:boolean;reverse:boolean}){
  const has=(source:string,target:string)=>pairs.some(pair=>pair.source===source&&pair.target===target);
  if(language.source!=="auto")return !language.autoReverse&&has(language.source,language.target);
  const pair=language.pair;
  if(!automatic.language||!pair||pair.length!==2||!pair.includes(language.target))return false;
  if(language.autoReverse){
    return automatic.reverse&&has(pair[0],pair[1])&&has(pair[1],pair[0]);
  }
  const source=pair.find(value=>value!==language.target);
  return typeof source==="string"&&has(source,language.target);
}

function policyMatchesConfiguration(policy:Policy,deployment:string,config:PublicModelRuntimeSnapshot){
  const components=publicModelComponents(config.executionPlan);
  if(policy.deploymentId!==deployment||policy.configurationHash!==config.configurationHash||policy.modelPolicyRevision!==config.modelPolicyRevision||
    policy.qualifiedComponents.length!==components.length||components.some(component=>!policy.qualifiedComponents.includes(component)))return false;
  const providerIds=[...new Set(components.map(component=>config.components[component]!.vendor))].sort();
  const availability=[...policy.providerAvailability].sort((a,b)=>a.providerId.localeCompare(b.providerId));
  return availability.length===providerIds.length&&availability.every((entry,index)=>entry.providerId===providerIds[index]&&entry.state==="available");
}

function readPolicy(file:string,key:string,now:Date,configuration?:PublicModelRuntimeSnapshot):Policy{
  let raw:string;try{const info=lstatSync(file);if(!info.isFile()||info.size<2||info.size>65536)throw Error();raw=readFileSync(file,"utf8");}catch{throw Error("public_runtime_admission_policy_unavailable");}
  let value:unknown;try{value=JSON.parse(raw);}catch{throw Error("public_runtime_admission_policy_invalid");}
  const entries=policiesFrom(value);if(!entries)throw Error("public_runtime_admission_policy_invalid");
  const policies=entries.map(policy=>validatePolicy(policy,key,now));
  if(!configuration){if(policies.length!==1)throw Error("public_runtime_admission_policy_scope_mismatch");return policies[0]!;}
  const components=publicModelComponents(configuration.executionPlan),matches=policies.filter(policy=>policy.deploymentId===configuration.deploymentId&&
    policy.configurationHash===configuration.configurationHash&&policy.modelPolicyRevision===configuration.modelPolicyRevision&&
    policy.qualifiedComponents.length===components.length&&components.every(component=>policy.qualifiedComponents.includes(component)));
  if(matches.length!==1)throw Error("public_runtime_admission_policy_scope_mismatch");return matches[0]!;
}

function policiesFrom(value:unknown):Policy[]|undefined{
  if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
  if((value as {schemaVersion?:unknown}).schemaVersion===1)return [value as Policy];
  const bundle=value as Partial<PolicyBundle>;
  if(bundle.schemaVersion!==2||Object.keys(bundle).some(field=>!policyBundleFields.includes(field))||!Array.isArray(bundle.policies)||bundle.policies.length<1||bundle.policies.length>8)return undefined;
  const identities=bundle.policies.map(policy=>policy&&typeof policy==="object"?`${(policy as Policy).deploymentId}\u0000${(policy as Policy).configurationHash}`:"");
  return identities.some(identity=>identity.length===0)||new Set(identities).size!==identities.length?undefined:bundle.policies as Policy[];
}

function validatePolicy(policy:Policy,key:string,now:Date):Policy{
  if(!policy||typeof policy!=="object"||Array.isArray(policy)||Object.keys(policy).some(field=>!policyFields.includes(field))||policy.schemaVersion!==1||
    ![policy.policyId,policy.deploymentId,policy.modelPolicyRevision,policy.region].every(syncKey)||!hex(policy.configurationHash,64)||!hex(policy.signature,64)||
    typeof policy.issuedAt!=="string"||typeof policy.expiresAt!=="string"||!Number.isFinite(Date.parse(policy.issuedAt))||!Number.isFinite(Date.parse(policy.expiresAt))||
    Date.parse(policy.issuedAt)>now.getTime()||Date.parse(policy.expiresAt)<=now.getTime()||(policy.maxActiveSeconds!==undefined&&(!Number.isSafeInteger(policy.maxActiveSeconds)||policy.maxActiveSeconds<1||policy.maxActiveSeconds>86400))||
    typeof policy.currency!=="string"||!/^[A-Z]{3}$/.test(policy.currency)||!Number.isSafeInteger(policy.reservedMicros)||policy.reservedMicros<0||
    (policy.automaticLanguage!==undefined&&typeof policy.automaticLanguage!=="boolean")||
    (policy.automaticReverse!==undefined&&typeof policy.automaticReverse!=="boolean")||
    (policy.automaticReverse===true&&policy.automaticLanguage!==true)||!Array.isArray(policy.qualifiedComponents)||
    new Set(policy.qualifiedComponents).size!==policy.qualifiedComponents.length||policy.qualifiedComponents.some(component=>!["asr","translation","tts"].includes(component))||
    !Array.isArray(policy.providerAvailability)||policy.providerAvailability.length<1||policy.providerAvailability.length>3||
    new Set(policy.providerAvailability.map(entry=>entry?.providerId)).size!==policy.providerAvailability.length||policy.providerAvailability.some(entry=>!entry||typeof entry!=="object"||Array.isArray(entry)||
      Object.keys(entry).some(field=>!["providerId","state"].includes(field))||!syncKey(entry.providerId)||!["available","unavailable"].includes(entry.state)))throw Error("public_runtime_admission_policy_invalid");
  if(!Array.isArray(policy.qualifiedLanguagePairs)||policy.qualifiedLanguagePairs.length<1||policy.qualifiedLanguagePairs.length>256||
    new Set(policy.qualifiedLanguagePairs.map(pair=>pair&&`${pair.source}\u0000${pair.target}`)).size!==policy.qualifiedLanguagePairs.length||
    policy.qualifiedLanguagePairs.some(pair=>!pair||typeof pair!=="object"||Array.isArray(pair)||Object.keys(pair).some(field=>!['source','target'].includes(field))||
      !isSupportedLanguage(pair.source)||pair.source==="auto"||!isTranslationLanguage(pair.target)||pair.source===pair.target))throw Error("public_runtime_admission_policy_invalid");
  const expected=signPublicRuntimeAdmissionPolicy(body(policy) as Omit<Policy,"signature">,key);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(policy.signature)))throw Error("public_runtime_admission_policy_signature_invalid");
  return policy;
}
