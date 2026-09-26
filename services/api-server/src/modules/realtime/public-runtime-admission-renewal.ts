import {publicRuntimeTokenBinding,type PublicRuntimeObservation} from "@translation/contracts";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {mutatePublicSession} from "../sessions/session-result-sync.service.js";
import {resultSyncHash,ResultSyncError} from "../sessions/session-result-sync-contract.js";
import {verifiedPublicAdmission} from "../sessions/public-runtime-admission.js";
import {inferenceProcessingHash,resolveInferenceEvidence,validateInferenceEvidence} from "../sessions/public-inference-evidence.js";
import {selectCurrentPublicModelConfiguration} from "../models/public-model-runtime-config.js";
import {queryPublicAdmission} from "./public-admission-query.service.js";
import {onlineSelectionConsent,type PublicRealtimeAuthority} from "./public-realtime-coordinator.js";
import type {SessionRecord} from "../sessions/session-record.js";

// Renew ahead of the existing 60s evidence-gap boundary. This is not a
// customer duration limit, a background supplier probe, or a new grant issuer.
const RENEW_BEFORE_MS=120_000;
export type PublicRuntimeAdmissionRenewer=ReturnType<typeof createPublicRuntimeAdmissionRenewer>;

/** Called only by the original authenticated runtime write, under its session
 * lock. Read-only admission/material queries stay read-only. The first active
 * observation, QA/capped leases and disconnected recovery are never renewed. */
export function createPublicRuntimeAdmissionRenewer(authority:PublicRealtimeAuthority){
  if(!Number.isSafeInteger(authority.timeoutMs)||authority.timeoutMs<250||authority.timeoutMs>30000)throw Error("public_authority_configuration_invalid");
  return async(sessionId:string,event:PublicRuntimeObservation)=>{
    const before=await findSession(sessionId),now=new Date();
    if(authority.qaOneShotGuard||!before||!eligible(before,event))return false;
    const policy=before.publicRuntimePolicy!,admission=verifiedPublicAdmission(before,before.userId,now);
    if(Date.parse(policy.expiresAt)-now.getTime()>RENEW_BEFORE_MS)return false;
    const config=before.publicModelConfiguration!,claims=before.publicRealtimeIssuance!.claims;
    const binding=publicRuntimeTokenBinding(claims,before.processingDeploymentId!);
    if(!binding)throw new ResultSyncError("public_admission_binding_mismatch",403);
    await queryPublicAdmission(sessionId,{...binding,contractVersion:1,requestId:`renewal-check:${event.sequence}`,
      sessionId,ownerId:before.userId,modelPolicyRevision:config.modelPolicyRevision,grantRef:admission.grantRef,purpose:"dispatch"},now);
    const selected=resolveInferenceEvidence(before,admission,now);
    // Only the original authenticated online selection can span operator
    // qualification rotations. Never extend arbitrary/synthetic consent.
    if(selected.consent.sourceReceiptId!=="account-online-selection")return false;
    const expectedHash=resultSyncHash(admission),stop=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    let resolved:Awaited<ReturnType<PublicRealtimeAuthority["resolveVerifiedEvidence"]>>;
    try{
      resolved=await Promise.race([
        Promise.resolve().then(()=>authority.resolveVerifiedEvidence({sessionId,ownerId:before.userId,
          deploymentId:before.processingDeploymentId!,processingHash:inferenceProcessingHash(before),
          configuration:structuredClone(config),languagePolicy:structuredClone(before.processingAuthorization!.languagePolicy)},stop.signal)),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>{stop.abort();reject(Error("public_renewal_timeout"));},authority.timeoutMs);}),
      ]);
    }catch{
      // A failed optional early refresh cannot revoke still-valid evidence.
      // The unchanged runtime verifier denies once that evidence expires.
      return false;
    }finally{if(timer)clearTimeout(timer);}
    if(stop.signal.aborted)return false;
    const checkedAt=new Date();
    if(!resolved||!Array.isArray(resolved.records)||resolved.records.length>32)throw new ResultSyncError("public_evidence_invalid",403);
    const records=structuredClone(resolved.records).filter(record=>record.kind!=="inference_consent");
    for(const record of records)validateInferenceEvidence(before,record,checkedAt);
    const consent=onlineSelectionConsent(before,records,checkedAt);
    const refs={...structuredClone(resolved.refs),consentReceiptId:consent.id};
    const nextEvidence=[consent,...records];
    if(new Set(nextEvidence.map(record=>record.id)).size!==nextEvidence.length)throw new ResultSyncError("public_evidence_conflict",409);
    const prospective={...before,publicInferenceEvidence:nextEvidence};
    const fresh=resolveInferenceEvidence(prospective,refs,checkedAt);
    if(nextEvidence.length!==fresh.qualifications.length+2||fresh.budget.maxActiveSeconds!==undefined||
      fresh.budget.sampleRate!==admission.sampleRate||fresh.budget.currency!==selected.budget.currency||
      fresh.consent.region!==selected.consent.region)throw new ResultSyncError("public_renewal_scope_mismatch",403);
    const qualificationExpiresAt=new Date(Math.min(...fresh.qualifications.map(record=>Date.parse(record.expiresAt)))).toISOString();
    const deadline=Math.min(Date.parse(fresh.consent.expiresAt),Date.parse(fresh.budget.expiresAt),Date.parse(qualificationExpiresAt));
    if(deadline<=Date.parse(policy.expiresAt))return false;
    return mutatePublicSession(sessionId,"public-admission-renewal",{expectedHash,evidenceHash:fresh.evidenceHash},current=>{
      const commitTime=new Date();
      // Recheck after the async authority call and again inside the original
      // PostgreSQL fence/CAS. A late resolver cannot revive expiry/revocation.
      if(!eligible(current,event))return {next:null,result:false};
      const old=verifiedPublicAdmission(current,current.userId,commitTime);
      if(resultSyncHash(old)!==expectedHash)return {next:null,result:false};
      if(resultSyncHash(current.publicModelConfiguration)!==resultSyncHash(config)||
        inferenceProcessingHash(current)!==admission.processingHash)throw new ResultSyncError("public_renewal_scope_mismatch",403);
      selectCurrentPublicModelConfiguration(config,()=>undefined);
      const next=structuredClone(current);next.publicInferenceEvidence=structuredClone(nextEvidence);
      const rechecked=resolveInferenceEvidence(next,refs,commitTime);
      next.publicInferenceAdmission={...old,...refs,evidenceHash:rechecked.evidenceHash,
        expiresAt:rechecked.consent.expiresAt,budgetExpiresAt:rechecked.budget.expiresAt,qualificationExpiresAt};
      verifiedPublicAdmission(next,next.userId,commitTime);
      const admissionHash=resultSyncHash(next.publicInferenceAdmission),previous=current.publicRuntimePolicy!;
      const revision=(previous.renewal?.revision??0)+1;
      if(!Number.isSafeInteger(revision))throw new ResultSyncError("public_renewal_revision_invalid",409);
      next.publicRuntimePolicy={...previous,admissionHash,expiresAt:new Date(deadline).toISOString(),
        renewal:{revision,renewedAt:commitTime.toISOString(),previousAdmissionHash:expectedHash,
          chainHash:resultSyncHash({previous:previous.renewal?.chainHash??expectedHash,admissionHash,revision})}};
      // Runtime/audio watermarks, issuance/JWT, Provider identity and customer
      // hold/ledger are deliberately untouched by this atomic metadata update.
      return {next,result:true};
    });
  };
}

function eligible(session:SessionRecord,event:PublicRuntimeObservation){
  const runtime=session.publicRuntime,policy=session.publicRuntimePolicy,issued=session.publicRealtimeIssuance;
  return event.phase==="active"&&session.status==="active"&&runtime?.phase==="active"&&!runtime.uncertain&&
    !runtime.stoppedAt&&!session.accountDeletionRequestedAt&&!session.finalizedAt&&!session.publicFinalization&&
    !session.finalizationIdempotencyKey&&!!session.publicModelConfiguration&&!!policy&&!!issued&&
    !issued.claims.qaOneShot&&issued.claims.maxDurationSeconds===undefined&&policy.maxActiveSeconds===undefined&&
    event.leaseId===policy.leaseId&&event.captureId===policy.captureId&&event.languagePolicyKey===policy.languagePolicyKey&&
    event.sequence===runtime.sequence+1&&event.finalRevision>=runtime.finalRevision&&event.lastAcceptedSample>=runtime.lastAcceptedSample;
}
