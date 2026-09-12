import type { PublicRecoveryStatus } from "@translation/contracts";
import {publicRuntimeAdmissionValid} from "./public-runtime-admission.js";
import { findSession } from "./sessions-runtime.repository.js";
import { publicDeploymentId, assertPublicSession, mutatePublicSession } from "./session-result-sync.service.js";
import { ResultSyncError, resultSyncHash } from "./session-result-sync-contract.js";
import { PUBLIC_EVIDENCE_GAP_MS, PUBLIC_RECOVERY_MS, runtimePolicy, stopWatermark,
  type PublicRuntimeEvidence } from "./public-session-lifecycle.js";

/** Called only from the existing internal authenticated server boundary.
 * No client timestamps, duration or providerUsage are accepted. */
export function observePublicRuntime(sessionId:string,value:unknown,now=new Date()) {
  const deployment=publicDeploymentId(),b=value as Record<string,unknown>|null;
  if(!b || Array.isArray(b) || Object.keys(b).some(k=>!["leaseId","captureId","languagePolicyKey",
    "sequence","phase","finalRevision","lastAcceptedSample"].includes(k)) ||
    !["active","paused","disconnected","stopped"].includes(String(b.phase)) ||
    !Number.isSafeInteger(b.sequence)||Number(b.sequence)<1 ||
    !Number.isSafeInteger(b.finalRevision)||Number(b.finalRevision)<0 ||
    !Number.isSafeInteger(b.lastAcceptedSample)||Number(b.lastAcceptedSample)<0) {
    throw new ResultSyncError("invalid_public_runtime_event",400);
  }
  return mutatePublicSession(sessionId,"public-runtime",b,current=>{
    assertPublicSession(current,current.userId,deployment);
    const p=runtimePolicy(current),old=current.publicRuntime;
    if(b.leaseId!==p.leaseId||b.captureId!==p.captureId||b.languagePolicyKey!==p.languagePolicyKey) {
      throw new ResultSyncError("public_runtime_lease_mismatch",403);
    }
    const admissionValid=publicRuntimeAdmissionValid(current,now);
    if(b.phase==="active"&&!admissionValid)throw new ResultSyncError("public_inference_admission_required",403);
    const hash=resultSyncHash(b);
    if(old && old.sequence===b.sequence && old.eventHash===hash) return {next:null,result:old};
    if(current.status==="ended"||current.status==="failed"||old?.stoppedAt) throw new ResultSyncError("public_runtime_terminal");
    if(Number(b.sequence)!==(old?.sequence??0)+1 || (!old&&(b.phase!=="active"||b.finalRevision!==0||b.lastAcceptedSample!==0)) ||
        Number(b.finalRevision)<(old?.finalRevision??0) || Number(b.lastAcceptedSample)<(old?.lastAcceptedSample??0)) {
      throw new ResultSyncError("public_runtime_sequence_conflict");
    }
    const timestamp=now.getTime(),last=old?Date.parse(old.observedAt):timestamp;
    if(timestamp<last) throw new ResultSyncError("public_runtime_clock_regressed");
    if(b.phase==="active"&&(timestamp>Date.parse(p.expiresAt) ||
        old?.recoveryUntil&&timestamp>Date.parse(old.recoveryUntil))) {
      throw new ResultSyncError("public_recovery_window_expired");
    }
    const gap=timestamp-last;
    const activeMs=(old?.activeMs??0)+(old?.phase==="active"&&gap<=PUBLIC_EVIDENCE_GAP_MS?gap:0);
    const uncertain=!admissionValid || !!old?.uncertain || old?.phase==="active"&&gap>PUBLIC_EVIDENCE_GAP_MS ||
      activeMs>p.maxActiveSeconds*1000 || old?.phase==="active"&&timestamp>Date.parse(p.expiresAt);
    const evidence:PublicRuntimeEvidence={sequence:Number(b.sequence),eventHash:hash,
      phase:b.phase as PublicRuntimeEvidence['phase'],observedAt:now.toISOString(),activeMs,
      uncertain:!!uncertain,finalRevision:Number(b.finalRevision),lastAcceptedSample:Number(b.lastAcceptedSample)};
    if(b.phase==="paused"&&old?.recoveryUntil)evidence.recoveryUntil=old.recoveryUntil;
    if(b.phase==="disconnected") evidence.recoveryUntil=old?.recoveryUntil??
      new Date(timestamp+PUBLIC_RECOVERY_MS).toISOString();
    if(b.phase==="stopped") {
      evidence.stoppedAt=now.toISOString();evidence.recoveryUntil=new Date(timestamp+PUBLIC_RECOVERY_MS).toISOString();
      evidence.finalRevisions=Object.fromEntries(current.segments.map(s=>[s.id,s.revision??0]));
    }
    const next=structuredClone(current);next.publicRuntime=evidence;next.lastActivityAt=now.toISOString();
    if(next.publicRecoveryOwnership&&(evidence.phase!=="disconnected"||
      next.publicRecoveryOwnership.runtimeSequence!==evidence.sequence))next.publicRecoveryOwnership=undefined;
    if(b.phase==="active")next.status="active";
    if(b.phase==="paused"||b.phase==="disconnected")next.status="paused";
    return {next,result:evidence};
  });
}

export async function publicRecoveryStatus(sessionId:string,ownerId:string,now=new Date()):Promise<PublicRecoveryStatus> {
  const deploymentId=publicDeploymentId(),session=await findSession(sessionId);
  if(!session) throw new ResultSyncError("session_not_found",404);
  assertPublicSession(session,ownerId,deploymentId);
  const p=runtimePolicy(session),r=session.publicRuntime;
  const recoveryUntil=r?.recoveryUntil??(r?new Date(Date.parse(r.observedAt)+PUBLIC_RECOVERY_MS).toISOString():undefined);
  const within=!!r&&publicRuntimeAdmissionValid(session,now)&&now.getTime()<=Date.parse(recoveryUntil!)&&now.getTime()<=Date.parse(p.expiresAt);
  return {contractVersion:1,sessionId,deploymentId,ownerId,
    modelPolicyRevision:session.processingAuthorization!.modelPolicyRevision,
    canResume:within&&!r?.uncertain&&!r?.stoppedAt&&["active","paused"].includes(session.status),
    canFinalize:!!session.publicFinalization || !!r?.stoppedAt&&!r.uncertain&&now.getTime()<=Date.parse(r.recoveryUntil!),
    recoveryUntil,meterStatus:!r?"missing":r.uncertain?"uncertain":"verified",
    ...(r?.stoppedAt?{stopWatermark:stopWatermark(session)}:{}),
    ...(session.publicFinalization?{finalization:session.publicFinalization.ack}:{})};
}
