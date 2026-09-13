import {createHmac,timingSafeEqual} from "node:crypto";
import {lstatSync,readFileSync} from "node:fs";
import {isAbsolute,resolve} from "node:path";
import {publicModelComponents} from "@translation/contracts";
import {canonicalSyncJson,syncKey} from "../sessions/session-result-sync-contract.js";
import type {PublicInferenceEvidence} from "../sessions/public-inference-evidence.js";
import type {PublicRealtimeAuthority} from "./public-realtime-coordinator.js";

type RuntimeEnv=Partial<Pick<NodeJS.ProcessEnv,"PUBLIC_RUNTIME_ENABLED"|"PUBLIC_RUNTIME_ADMISSION_POLICY_FILE"|"PUBLIC_RUNTIME_ADMISSION_POLICY_KEY"|"API_RESULT_SYNC_DEPLOYMENT_ID">>;
type Policy={schemaVersion:1;policyId:string;deploymentId:string;configurationHash:string;modelPolicyRevision:string;region:string;
  issuedAt:string;expiresAt:string;maxActiveSeconds?:number;currency:string;reservedMicros:number;qualifiedComponents:Array<"asr"|"translation"|"tts">;signature:string;};
const enabled=(value:unknown)=>typeof value==="string"&&value.trim().toLowerCase()==="true";
const hex=(value:unknown,length:number)=>typeof value==="string"&&new RegExp(`^[a-f0-9]{${length}}$`,"i").test(value);
const policyFields=["schemaVersion","policyId","deploymentId","configurationHash","modelPolicyRevision","region","issuedAt","expiresAt","maxActiveSeconds","currency","reservedMicros","qualifiedComponents","signature"];
const body=(policy:Policy)=>Object.fromEntries(Object.entries(policy).filter(([key])=>key!=="signature"));

/** Signs the operator policy body; callers own storage and never receive model credentials. */
export function signPublicRuntimeAdmissionPolicy(policy:Omit<Policy,"signature">,key:string){
  if(!hex(key,64))throw Error("public_runtime_admission_policy_key_invalid");
  return createHmac("sha256",key).update(canonicalSyncJson(policy)).digest("hex");
}

/** Default deny. A signed policy can authorize only configuration-bound free or paid budget metadata; it never probes a provider. */
export function publicRealtimeAuthorityFromEnvironment(env:RuntimeEnv=process.env):PublicRealtimeAuthority|undefined{
  if(!enabled(env.PUBLIC_RUNTIME_ENABLED))return undefined;
  const file=env.PUBLIC_RUNTIME_ADMISSION_POLICY_FILE,key=env.PUBLIC_RUNTIME_ADMISSION_POLICY_KEY,deployment=env.API_RESULT_SYNC_DEPLOYMENT_ID;
  if(typeof file!=="string"||!isAbsolute(file)||!hex(key,64)||!syncKey(deployment))throw Error("public_runtime_admission_policy_not_configured");
  return {timeoutMs:5000,resolveVerifiedEvidence:async context=>resolvePolicy(file,key!,deployment!,context)};
}

function resolvePolicy(file:string,key:string,deployment:string,context:Parameters<PublicRealtimeAuthority["resolveVerifiedEvidence"]>[0]){
  const policy=readPolicy(file,key,new Date()),config=context.configuration,components=publicModelComponents(config.executionPlan);
  if(policy.deploymentId!==deployment||policy.deploymentId!==context.deploymentId||policy.configurationHash!==config.configurationHash||policy.modelPolicyRevision!==config.modelPolicyRevision||
    policy.modelPolicyRevision!==context.configuration.modelPolicyRevision||policy.qualifiedComponents.length!==components.length||components.some(component=>!policy.qualifiedComponents.includes(component)))throw Error("public_runtime_admission_policy_scope_mismatch");
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

function readPolicy(file:string,key:string,now:Date):Policy{
  let raw:string;try{const info=lstatSync(file);if(!info.isFile()||info.size<2||info.size>65536)throw Error();raw=readFileSync(file,"utf8");}catch{throw Error("public_runtime_admission_policy_unavailable");}
  let policy:Policy;try{policy=JSON.parse(raw);}catch{throw Error("public_runtime_admission_policy_invalid");}
  if(!policy||typeof policy!=="object"||Array.isArray(policy)||Object.keys(policy).some(field=>!policyFields.includes(field))||policy.schemaVersion!==1||
    ![policy.policyId,policy.deploymentId,policy.modelPolicyRevision,policy.region].every(syncKey)||!hex(policy.configurationHash,64)||!hex(policy.signature,64)||
    typeof policy.issuedAt!=="string"||typeof policy.expiresAt!=="string"||!Number.isFinite(Date.parse(policy.issuedAt))||!Number.isFinite(Date.parse(policy.expiresAt))||
    Date.parse(policy.issuedAt)>now.getTime()||Date.parse(policy.expiresAt)<=now.getTime()||(policy.maxActiveSeconds!==undefined&&(!Number.isSafeInteger(policy.maxActiveSeconds)||policy.maxActiveSeconds<1||policy.maxActiveSeconds>86400))||
    typeof policy.currency!=="string"||!/^[A-Z]{3}$/.test(policy.currency)||!Number.isSafeInteger(policy.reservedMicros)||policy.reservedMicros<0||!Array.isArray(policy.qualifiedComponents)||
    new Set(policy.qualifiedComponents).size!==policy.qualifiedComponents.length||policy.qualifiedComponents.some(component=>!["asr","translation","tts"].includes(component)))throw Error("public_runtime_admission_policy_invalid");
  const expected=signPublicRuntimeAdmissionPolicy(body(policy) as Omit<Policy,"signature">,key);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(policy.signature)))throw Error("public_runtime_admission_policy_signature_invalid");
  return policy;
}
