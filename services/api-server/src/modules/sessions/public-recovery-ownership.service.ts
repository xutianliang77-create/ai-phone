import { publicRuntimeAdmissionValid } from "./public-runtime-admission.js";
import { publicDeploymentId, assertPublicSession, mutatePublicSession } from "./session-result-sync.service.js";
import { ResultSyncError, syncKey } from "./session-result-sync-contract.js";
import { runtimePolicy, type PublicRecoveryOwnership } from "./public-session-lifecycle.js";

export function claimPublicRecoveryOwnership(sessionId:string,value:unknown,now=new Date()) {
  const deployment=publicDeploymentId(),request=parseClaim(value);
  return mutatePublicSession<PublicRecoveryOwnership>(sessionId,"public-recovery-ownership",request,current=>{
    assertPublicSession(current,current.userId,deployment);
    const policy=runtimePolicy(current),runtime=current.publicRuntime;
    const until=runtime?.recoveryUntil?Date.parse(runtime.recoveryUntil):Number.NaN;
    if(!runtime||runtime.phase!=="disconnected"||runtime.uncertain||runtime.stoppedAt||
      !publicRuntimeAdmissionValid(current,now)||!Number.isFinite(until)||until<=now.getTime()||
      Date.parse(policy.expiresAt)<=now.getTime())throw new ResultSyncError("public_recovery_not_claimable",409);
    if(request.runtimeSequence!==runtime.sequence)throw new ResultSyncError("public_recovery_ownership_watermark_conflict",409);
    const old=current.publicRecoveryOwnership;
    if(old&&old.expiresAt===runtime.recoveryUntil&&Date.parse(old.expiresAt)>now.getTime()){
      if(old.ownerId!==request.ownerId||old.runtimeSequence!==request.runtimeSequence)throw new ResultSyncError("public_recovery_owned",409);
      return {next:null,result:structuredClone(old)};
    }
    const ownership:PublicRecoveryOwnership={ownerId:request.ownerId,runtimeSequence:request.runtimeSequence,
      claimedAt:now.toISOString(),expiresAt:runtime.recoveryUntil!};
    const next=structuredClone(current);next.publicRecoveryOwnership=ownership;
    return {next,result:structuredClone(ownership)};
  });
}

function parseClaim(value:unknown) {
  const body=value as Record<string,unknown>|null;
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!["ownerId","runtimeSequence"].includes(key))||
    !syncKey(body.ownerId)||String(body.ownerId).length>160||!Number.isSafeInteger(body.runtimeSequence)||
    Number(body.runtimeSequence)<1)throw new ResultSyncError("invalid_public_recovery_ownership",400);
  return {ownerId:String(body.ownerId),runtimeSequence:Number(body.runtimeSequence)};
}
