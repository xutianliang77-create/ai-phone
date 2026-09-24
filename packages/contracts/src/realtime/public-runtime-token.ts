import type {RealtimeTokenClaims} from "./session.js";
import {parseRealtimeProcessingRequest,processingMatchesSession} from "./processing-contract.js";
import { isDeviceSpeakerSelection } from "./device-speaker.js";

/** Signed projection of an existing server lease, not a new grant or credential. */
export interface PublicRuntimeTokenBinding {
  deploymentId:string;leaseId:string;captureId:string;languagePolicyKey:string;
  sampleRate:16000|24000;configurationRevision:number;configurationHash:string;
}
const key=(v:unknown):v is string=>typeof v==="string"&&v.length>0&&v.length<=240&&v.trim()===v&&
  !/[\u0000-\u001f\u007f]/u.test(v)&&!["__proto__","constructor","prototype"].includes(v);
export function validQaOneShotClaim(claims:RealtimeTokenClaims){
  const qa=claims.qaOneShot;
  if(qa===undefined)return true;
  return !!qa&&typeof qa==="object"&&!Array.isArray(qa)&&
    Object.keys(qa).length===2&&Object.keys(qa).every(field=>["authorizationId","hardDeadlineAt"].includes(field))&&
    key(qa.authorizationId)&&Number.isSafeInteger(qa.hardDeadlineAt)&&
    qa.hardDeadlineAt>claims.issuedAt&&qa.hardDeadlineAt<=claims.issuedAt+45&&
    qa.hardDeadlineAt<=claims.expiresAt&&
    claims.publicRuntime!==undefined&&claims.processing?.processingMode==="online"&&
    Number.isSafeInteger(claims.maxDurationSeconds)&&claims.maxDurationSeconds!>0&&
    claims.maxDurationSeconds===qa.hardDeadlineAt-claims.issuedAt;
}
/** Use only AFTER verifying the token signature and expiration. This verifies
 * binding syntax/consistency; stored grant/lease/revocation checks remain mandatory. */
export function publicRuntimeTokenBinding(claims:RealtimeTokenClaims,deploymentId:string):PublicRuntimeTokenBinding|null {
  const speaker=claims?.speakerAttribution;
  if(speaker&&!isDeviceSpeakerSelection(speaker)&&
    (speaker.mode!=="off"||speaker.allowVoiceIdentity||speaker.deviceProfile!==undefined))return null;
  const p=claims?.processing,b=claims?.publicRuntime;
  if(!key(deploymentId)||!validQaOneShotClaim(claims)||!p||!b||typeof b!=="object"||Array.isArray(b)||
    Object.keys(p).some(k=>!["contractVersion","processingMode","modelPolicyRevision","languagePolicy","executionPlan","syncPermission","publicGrantRef"].includes(k))||
    Object.keys(b).length!==7||Object.keys(b).some(k=>!["deploymentId","leaseId","captureId","languagePolicyKey","sampleRate","configurationRevision","configurationHash"].includes(k))||
    b.deploymentId!==deploymentId||![b.leaseId,b.captureId,b.languagePolicyKey,p.publicGrantRef,claims.sessionId,claims.userId].every(key)||
    ![16000,24000].includes(b.sampleRate)||!Number.isSafeInteger(b.configurationRevision)||b.configurationRevision<1||
    typeof b.configurationHash!=="string"||!/^[a-f0-9]{64}$/.test(b.configurationHash)||p.processingMode!=="online")return null;
  const sync=p.syncPermission;
  if(!sync||typeof sync!=="object"||Array.isArray(sync)||
    (sync.allowed===false?Object.keys(sync).length!==1:sync.allowed!==true||Object.keys(sync).length!==2||!key(sync.scopeId)))return null;
  const request={contractVersion:p.contractVersion,processingMode:p.processingMode,modelPolicyRevision:p.modelPolicyRevision,
    languagePolicy:p.languagePolicy,executionPlan:p.executionPlan,syncRequested:false};
  if(parseRealtimeProcessingRequest(request).status!=="valid"||!processingMatchesSession(request,claims))return null;
  return {...b};
}
