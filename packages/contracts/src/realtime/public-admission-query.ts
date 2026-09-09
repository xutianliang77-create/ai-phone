import type {PublicRuntimeTokenBinding} from "./public-runtime-token.js";
export interface PublicAdmissionQuery extends PublicRuntimeTokenBinding {
  contractVersion:1;requestId:string;sessionId:string;ownerId:string;modelPolicyRevision:string;grantRef:string;purpose:"connect"|"dispatch"|"recovery";
}
export interface PublicRecoveryCheckpoint {
  runtimeSequence:number;lastAcceptedSample:number;finalRevision:number;activeMs:number;recoveryUntil:string;
}
export interface PublicAdmissionReceipt extends PublicAdmissionQuery {
  allowed:true;checkedAt:string;expiresAt:string;maxActiveSeconds:number;status:"created"|"active"|"paused";
  /** Read-only observation, never an ownership/transport or inference grant. */
  recovery?:PublicRecoveryCheckpoint;
}
const queryKeys=["contractVersion","requestId","sessionId","ownerId","modelPolicyRevision","grantRef","purpose",
  "deploymentId","leaseId","captureId","languagePolicyKey","sampleRate","configurationRevision","configurationHash"];
const key=(v:unknown)=>typeof v==="string"&&v.length>0&&v.length<=240&&v.trim()===v&&!/[\u0000-\u001f\u007f]/u.test(v)&&!["__proto__","prototype","constructor"].includes(v);
export function isPublicAdmissionQuery(value:unknown):value is PublicAdmissionQuery {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const q=value as PublicAdmissionQuery;
  return Object.keys(q).length===queryKeys.length&&Object.keys(q).every(k=>queryKeys.includes(k))&&q.contractVersion===1&&
    [q.requestId,q.sessionId,q.ownerId,q.modelPolicyRevision,q.grantRef,q.deploymentId,q.leaseId,q.captureId,q.languagePolicyKey].every(key)&&
    ["connect","dispatch","recovery"].includes(q.purpose)&&[16000,24000].includes(q.sampleRate)&&Number.isSafeInteger(q.configurationRevision)&&q.configurationRevision>0&&
    typeof q.configurationHash==="string"&&/^[a-f0-9]{64}$/.test(q.configurationHash);
}
/** Match every requested identity plus a per-request nonce. An ACK must never be
 * cached as a permanent inference grant; the model-attempt writer also rechecks. */
export function matchesPublicAdmissionReceipt(value:unknown,query:PublicAdmissionQuery,now=Date.now()):value is PublicAdmissionReceipt {
  if(!value||typeof value!=="object"||Array.isArray(value)||!isPublicAdmissionQuery(query))return false;
  const r=value as PublicAdmissionReceipt;
  const recovery=query.purpose==="recovery";
  return Object.keys(r).length===queryKeys.length+(recovery?6:5)&&Object.keys(r).every(k=>queryKeys.includes(k)||["allowed","checkedAt","expiresAt","maxActiveSeconds","status",...(recovery?["recovery"]:[])].includes(k))&&
    queryKeys.every(k=>r[k as keyof PublicAdmissionQuery]===query[k as keyof PublicAdmissionQuery])&&r.allowed===true&&
    r.status===(recovery?"paused":query.purpose==="connect"?"created":"active")&&typeof r.checkedAt==="string"&&typeof r.expiresAt==="string"&&
    Number.isFinite(now)&&Math.abs(now-Date.parse(r.checkedAt))<=30000&&Date.parse(r.expiresAt)>now&&
    Number.isSafeInteger(r.maxActiveSeconds)&&r.maxActiveSeconds>0&&r.maxActiveSeconds<=86400&&
    (!recovery||validCheckpoint(r.recovery,r.maxActiveSeconds,now,Date.parse(r.expiresAt)));
}
function validCheckpoint(value:unknown,maxSeconds:number,now:number,expiry:number):value is PublicRecoveryCheckpoint {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const r=value as PublicRecoveryCheckpoint;
  return Object.keys(r).length===5&&Object.keys(r).every(k=>["runtimeSequence","lastAcceptedSample","finalRevision","activeMs","recoveryUntil"].includes(k))&&
    [r.runtimeSequence,r.lastAcceptedSample,r.finalRevision,r.activeMs].every(v=>Number.isSafeInteger(v)&&v>=0)&&r.runtimeSequence>0&&
    r.activeMs<maxSeconds*1000&&typeof r.recoveryUntil==="string"&&Date.parse(r.recoveryUntil)>now&&Date.parse(r.recoveryUntil)<=expiry;
}
