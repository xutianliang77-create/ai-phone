import {isPublicAdmissionQuery,publicRuntimeTokenBinding,type PublicAdmissionReceipt} from "@translation/contracts";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {publicDeploymentId,assertPublicSession} from "../sessions/session-result-sync.service.js";
import {verifiedPublicAdmission} from "../sessions/public-runtime-admission.js";
import {inferenceProcessingHash} from "../sessions/public-inference-evidence.js";
import {selectCurrentPublicModelConfiguration} from "../models/public-model-runtime-config.js";
import {ResultSyncError,resultSyncHash} from "../sessions/session-result-sync-contract.js";
import {PUBLIC_EVIDENCE_GAP_MS,PUBLIC_RECOVERY_MS} from "../sessions/public-session-lifecycle.js";

/** Read only. No new lease, hold, activity, model call or credential return.
 * The internal HTTP boundary authenticates the requesting Gateway separately. */
export async function queryPublicAdmission(sessionId:string,value:unknown,now=new Date()):Promise<PublicAdmissionReceipt>{
  if(!isPublicAdmissionQuery(value)||value.sessionId!==sessionId||!Number.isFinite(now.getTime()))throw new ResultSyncError("public_admission_query_invalid",400);
  const q=structuredClone(value),deployment=publicDeploymentId();
  if(q.deploymentId!==deployment)throw new ResultSyncError("public_admission_scope_mismatch",403);
  const session=await findSession(sessionId);if(!session)throw new ResultSyncError("session_not_found",404);
  assertPublicSession(session,q.ownerId,deployment);
  const admission=verifiedPublicAdmission(session,q.ownerId,now),policy=session.publicRuntimePolicy,issued=session.publicRealtimeIssuance,config=session.publicModelConfiguration;
  if(!policy||!issued||!config||session.finalizedAt||session.publicFinalization||session.finalizationIdempotencyKey||session.publicRuntime?.stoppedAt)throw new ResultSyncError("public_admission_not_issued",403);
  const binding=publicRuntimeTokenBinding(issued.claims,deployment);
  if(!binding||Object.entries(binding).some(([k,v])=>q[k as keyof typeof q]!==v)||q.grantRef!==admission.grantRef||
    q.modelPolicyRevision!==config.modelPolicyRevision||issued.claims.userId!==q.ownerId||issued.claims.sessionId!==sessionId||
    config.configurationHash!==q.configurationHash||config.configurationRevision!==q.configurationRevision||config.components.asr?.sampleRate!==q.sampleRate||
    inferenceProcessingHash({...session,processingAuthorization:issued.claims.processing})!==inferenceProcessingHash(session)||
    policy.admissionHash!==resultSyncHash(admission)||policy.sampleRate!==q.sampleRate||policy.leaseId!==q.leaseId||policy.captureId!==q.captureId||policy.languagePolicyKey!==q.languagePolicyKey||
    policy.languagePolicyKey!==`language:${resultSyncHash(session.processingAuthorization!.languagePolicy)}`||
    !Number.isSafeInteger(policy.maxActiveSeconds)||policy.maxActiveSeconds<1||policy.maxActiveSeconds>admission.maxActiveSeconds||
    Date.parse(policy.expiresAt)!==Math.min(...[admission.expiresAt,admission.budgetExpiresAt,admission.qualificationExpiresAt].map(Date.parse))||Date.parse(policy.expiresAt)<=now.getTime())throw new ResultSyncError("public_admission_binding_mismatch",403);
  selectCurrentPublicModelConfiguration(config,()=>undefined); // Never return raw credentials.
  if(q.purpose==="recovery"){
    const r=session.publicRuntime,observed=r?Date.parse(r.observedAt):NaN,until=r?Date.parse(r.recoveryUntil??""):NaN;
    if(session.status!=="paused"||r?.phase!=="disconnected"||r.uncertain||!Number.isFinite(observed)||observed>now.getTime()||
      !Number.isFinite(until)||until<=now.getTime()||until>observed+PUBLIC_RECOVERY_MS||
      ![r.sequence,r.lastAcceptedSample,r.finalRevision,r.activeMs].every(v=>Number.isSafeInteger(v)&&v>=0)||r.sequence<1||r.activeMs>=policy.maxActiveSeconds*1000) {
      throw new ResultSyncError("public_recovery_checkpoint_denied",403);
    }
    return {...q,allowed:true,checkedAt:now.toISOString(),expiresAt:policy.expiresAt,maxActiveSeconds:policy.maxActiveSeconds,status:"paused",
      recovery:{runtimeSequence:r.sequence,lastAcceptedSample:r.lastAcceptedSample,finalRevision:r.finalRevision,activeMs:r.activeMs,
        recoveryUntil:new Date(Math.min(until,Date.parse(policy.expiresAt))).toISOString()}};
  }
  if(q.purpose==="connect"){
    if(session.status!=="created"||session.publicRuntime||issued.claims.expiresAt<=Math.floor(now.getTime()/1000))throw new ResultSyncError("public_admission_connect_denied",403);
  }else{
    const r=session.publicRuntime,timestamp=r?Date.parse(r.observedAt):NaN;
    if(session.status!=="active"||r?.phase!=="active"||r.uncertain||!Number.isFinite(timestamp)||timestamp>now.getTime()||
      now.getTime()-timestamp>PUBLIC_EVIDENCE_GAP_MS||r.activeMs+now.getTime()-timestamp>=policy.maxActiveSeconds*1000)throw new ResultSyncError("public_admission_dispatch_denied",403);
  }
  return {...q,allowed:true,checkedAt:now.toISOString(),expiresAt:policy.expiresAt,maxActiveSeconds:policy.maxActiveSeconds,status:q.purpose==="connect"?"created":"active"};
}
