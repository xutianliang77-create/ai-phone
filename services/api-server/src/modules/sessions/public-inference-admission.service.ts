import {randomUUID} from "node:crypto";
import {assertPublicSession,publicDeploymentId,mutatePublicSession} from "./session-result-sync.service.js";
import {ResultSyncError,resultSyncHash,syncKey} from "./session-result-sync-contract.js";
import {resolveInferenceEvidence,validateInferenceEvidence,inferenceProcessingHash,type PublicInferenceEvidence,type InferenceEvidenceRefs} from "./public-inference-evidence.js";
import {verifiedPublicAdmission,type PublicInferenceAdmission} from "./public-runtime-admission.js";

/** Internal server producers only. No HTTP endpoint accepts evidence. This records
 * externally verified metadata; it does not itself contact a supplier or reserve funds. */
export function recordPublicInferenceEvidence(sessionId:string,ownerId:string,evidence:PublicInferenceEvidence,now=new Date()){
  const snapshot=structuredClone(evidence),deployment=publicDeploymentId();
  return mutatePublicSession(sessionId,"public-inference-evidence",snapshot,current=>{
    assertPublicSession(current,ownerId,deployment);validateInferenceEvidence(current,snapshot,now);
    if(current.status!=="created"||current.publicRuntimePolicy)throw new ResultSyncError("public_evidence_sealed");
    const old=current.publicInferenceEvidence??[],existing=old.find(e=>e.id===snapshot.id);
    if(existing){if(resultSyncHash(existing)!==resultSyncHash(snapshot))throw new ResultSyncError("public_evidence_conflict");return {next:null,result:structuredClone(existing)};}
    if(old.length>=32)throw new ResultSyncError("public_evidence_capacity");
    const next=structuredClone(current);next.publicInferenceEvidence=[...old,snapshot];return {next,result:structuredClone(snapshot)};
  });
}
export function writePublicInferenceAdmission(sessionId:string,ownerId:string,refs:InferenceEvidenceRefs,now=new Date()){
  if(!refs||Array.isArray(refs)||Object.keys(refs).some(k=>!["consentReceiptId","budgetReservationId","qualificationReceiptIds"].includes(k))){
    throw new ResultSyncError("public_evidence_invalid",400);
  }
  const snapshot=structuredClone(refs),deployment=publicDeploymentId();
  return mutatePublicSession<PublicInferenceAdmission>(sessionId,"public-inference-admission",snapshot,current=>{
    assertPublicSession(current,ownerId,deployment);
    if(current.status!=="created"||current.publicRuntimePolicy||current.publicRuntime)throw new ResultSyncError("public_admission_sealed");
    const resolved=resolveInferenceEvidence(current,snapshot,now);
    if(current.publicInferenceAdmission){
      const old=current.publicInferenceAdmission;
      if(old.revokedAt!==undefined||old.evidenceHash!==resolved.evidenceHash)throw new ResultSyncError("public_admission_evidence_conflict");
      return {next:null,result:structuredClone(verifiedPublicAdmission(current,ownerId,now))};
    }
    const a:PublicInferenceAdmission={...snapshot,grantRef:randomUUID(),ownerId,deploymentId:deployment,
      processingHash:inferenceProcessingHash(current),evidenceHash:resolved.evidenceHash,issuedAt:now.toISOString(),
      expiresAt:resolved.consent.expiresAt,budgetExpiresAt:resolved.budget.expiresAt,
      qualificationExpiresAt:new Date(Math.min(...resolved.qualifications.map(q=>Date.parse(q.expiresAt)))).toISOString(),
      maxActiveSeconds:resolved.budget.maxActiveSeconds,sampleRate:resolved.budget.sampleRate};
    const next=structuredClone(current);next.publicInferenceAdmission=a;next.processingAuthorization!.publicGrantRef=a.grantRef;
    return {next,result:structuredClone(a)};
  });
}
export function revokePublicInferenceEvidence(sessionId:string,ownerId:string,receiptId:string,now=new Date()){
  const deployment=publicDeploymentId();
  if(!syncKey(receiptId)||!Number.isFinite(now.getTime()))throw new ResultSyncError("public_evidence_invalid",400);
  return mutatePublicSession(sessionId,"public-evidence-revoke",{receiptId},current=>{
    assertPublicSession(current,ownerId,deployment);
    const receipt=current.publicInferenceEvidence?.find(e=>e.id===receiptId);
    if(!receipt)throw new ResultSyncError("public_evidence_not_found",404);
    if(receipt.revokedAt)return {next:null,result:receipt.revokedAt};
    if(now.getTime()<Date.parse(receipt.issuedAt))throw new ResultSyncError("public_evidence_invalid",400);
    const next=structuredClone(current);const revokedAt=now.toISOString();
    next.publicInferenceEvidence!.find(e=>e.id===receiptId)!.revokedAt=revokedAt;
    const a=next.publicInferenceAdmission;
    if(a&&[a.consentReceiptId,a.budgetReservationId,...Object.values(a.qualificationReceiptIds)].includes(receiptId))a.revokedAt??=revokedAt;
    return {next,result:revokedAt};
  });
}
