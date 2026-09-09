import {randomUUID} from "node:crypto";
import {publicModelComponents} from "@translation/contracts";
import type {SessionRecord} from "./session-record.js";
import type {PublicRuntimePolicy} from "./public-session-lifecycle.js";
import {publicDeploymentId,assertPublicSession,mutatePublicSession} from "./session-result-sync.service.js";
import {ResultSyncError,resultSyncHash,syncKey} from "./session-result-sync-contract.js";
import {assertAdmissionEvidence,inferenceProcessingHash} from "./public-inference-evidence.js";

/** Internal aggregate record produced only AFTER authoritative inference consent,
 * provider qualification and budget reservation. No HTTP route accepts this object.
 * Stored receipt resolution is mandatory; real consent/budget/qualification producers
 * and public admission remain unwired. Text-sync consent is unrelated. */
export interface PublicInferenceAdmission {
  evidenceHash?:string;
  grantRef:string; ownerId:string; deploymentId:string; processingHash:string;
  consentReceiptId:string; budgetReservationId:string;
  qualificationReceiptIds:Partial<Record<"asr"|"translation"|"tts",string>>;
  issuedAt:string; expiresAt:string; budgetExpiresAt:string; qualificationExpiresAt:string;
  maxActiveSeconds:number; sampleRate:16000|24000;
  revokedAt?:string;
}

export function publicProcessingHash(session:SessionRecord) {
  return inferenceProcessingHash(session);
}
export function verifiedPublicAdmission(session:SessionRecord,ownerId:string,now:Date) {
  const deploymentId=publicDeploymentId();assertPublicSession(session,ownerId,deploymentId);
  const a=session.publicInferenceAdmission;
  if(!a || a.ownerId!==ownerId||a.deploymentId!==deploymentId||
      session.processingAuthorization!.publicGrantRef!==a.grantRef ||
      ![a.grantRef,a.consentReceiptId,a.budgetReservationId].every(syncKey)||
      a.processingHash!==publicProcessingHash(session)||a.revokedAt!==undefined ||
      !Number.isSafeInteger(a.maxActiveSeconds)||a.maxActiveSeconds<1||a.maxActiveSeconds>86400||
      ![16000,24000].includes(a.sampleRate))throw new ResultSyncError("public_inference_admission_required",503);
  const times=[a.issuedAt,a.expiresAt,a.budgetExpiresAt,a.qualificationExpiresAt];
  if(times.some(t=>typeof t!=="string"))throw new ResultSyncError("public_inference_admission_expired",403);
  const timestamps=times.map(Date.parse);
  if(!Number.isFinite(now.getTime())||timestamps.some(t=>!Number.isFinite(t))||timestamps[0]>now.getTime()||
      timestamps.slice(1).some(t=>t<=now.getTime()))throw new ResultSyncError("public_inference_admission_expired",403);
  for(const component of publicModelComponents(session.processingAuthorization!.executionPlan)){
    if(!syncKey(a.qualificationReceiptIds?.[component]))throw new ResultSyncError("public_component_qualification_required",503);
  }
  assertAdmissionEvidence(session,a,now);
  return a;
}

/** Server-domain operation, not client-granted policy. Does not create a session,
 * reserve money, invoke a provider or open public admission. The eventual admission
 * writer consumes recorded evidence; its real producers remain separately gated. */
export function issuePublicRuntimeLease(sessionId:string,ownerId:string,now=new Date()) {
  return mutatePublicSession<PublicRuntimePolicy>(sessionId,"public-runtime-lease",{ownerId},current=>{
    const admission=verifiedPublicAdmission(current,ownerId,now);
    const admissionHash=resultSyncHash(admission);
    if(current.status==="ended"||current.status==="failed"||current.finalizationIdempotencyKey||current.publicRuntime?.stoppedAt){
      throw new ResultSyncError("public_runtime_terminal");
    }
    if(current.publicRuntimePolicy){
      if(current.publicRuntimePolicy.admissionHash!==admissionHash||
          Date.parse(current.publicRuntimePolicy.expiresAt)<=now.getTime())throw new ResultSyncError("public_runtime_lease_conflict");
      return {next:null,result:structuredClone(current.publicRuntimePolicy)};
    }
    if(current.status!=="created"||current.publicRuntime)throw new ResultSyncError("public_runtime_lease_conflict");
    const deadline=Math.min(...[admission.expiresAt,admission.budgetExpiresAt,admission.qualificationExpiresAt].map(Date.parse));
    const maxActiveSeconds=Math.min(admission.maxActiveSeconds,Math.floor((deadline-now.getTime())/1000));
    if(maxActiveSeconds<1)throw new ResultSyncError("public_inference_admission_expired",403);
    const policy:PublicRuntimePolicy={leaseId:randomUUID(),captureId:randomUUID(),
      languagePolicyKey:`language:${resultSyncHash(current.processingAuthorization!.languagePolicy)}`,
      admissionHash,sampleRate:admission.sampleRate,expiresAt:new Date(deadline).toISOString(),maxActiveSeconds};
    const next=structuredClone(current);next.publicRuntimePolicy=policy;
    return {next,result:structuredClone(policy)};
  });
}

/** Re-evaluate the same admission for newly issued leases on every active observation.
 * Legacy synthetic S3 policies remain compatible; this does not qualify them for admission. */
export function publicRuntimeAdmissionValid(session:SessionRecord,now:Date) {
  if(!session.publicRuntimePolicy?.admissionHash)return true;
  try{return resultSyncHash(verifiedPublicAdmission(session,session.userId,now))===session.publicRuntimePolicy.admissionHash;}
  catch{return false;}
}
