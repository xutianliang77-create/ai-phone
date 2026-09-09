import type { PublicFinalizeAck, PublicFinalizeRequest } from "@translation/contracts";
import {getStoreSnapshot,persistStoreSnapshot,runStoreTransaction} from "../../infrastructure/storage/json-store.js";
import {getRepositoryRuntime} from "../../infrastructure/storage/repository-runtime.js";
import {withPostgresRepositoryFence} from "../../infrastructure/storage/postgres-repository-fence.js";
import {repositoryCommandId,repositoryRequestHash} from "../../infrastructure/storage/repository-command-identity.js";
import {activePlanForUser} from "../plans/plans-runtime.service.js";
import {findBillingLedgerEntryByIdempotencyKey} from "../billing/billing-ledger.service.js";
import {completeSessionWithUsageTransaction} from "./session-completion.js";
import {normalizeMeasuredBillableSeconds} from "./session-usage-settlement.js";
import {assertPublicSession,publicDeploymentId} from "./session-result-sync.service.js";
import {ResultSyncError,resultSyncHash} from "./session-result-sync-contract.js";
import {parsePublicFinalize,stopWatermark,validatePublicStop} from "./public-session-lifecycle.js";
import type {SessionRecord} from "./session-record.js";

function plan(current:SessionRecord,ownerId:string,request:PublicFinalizeRequest,now:Date,serverRecovery:boolean) {
  const deploymentId=publicDeploymentId();assertPublicSession(current,ownerId,deploymentId);
  if(request.deploymentId!==deploymentId || request.modelPolicyRevision!==current.processingAuthorization!.modelPolicyRevision) {
    throw new ResultSyncError("public_finalization_identity_conflict",403);
  }
  const requestHash=resultSyncHash(request);
  if(current.publicFinalization){
    if(current.publicFinalization.requestHash!==requestHash)throw new ResultSyncError("public_finalization_conflict");
    return {ack:current.publicFinalization.ack,next:null};
  }
  validatePublicStop(current,request);
  if(now.getTime()<Date.parse(current.publicRuntime!.stoppedAt!))throw new ResultSyncError("public_runtime_clock_regressed",503);
  if(current.status==="ended"||current.finalizationIdempotencyKey)throw new ResultSyncError("public_finalization_unverified_terminal",503);
  if(!serverRecovery&&now.getTime()>Date.parse(current.publicRuntime!.recoveryUntil!)) {
    throw new ResultSyncError("public_recovery_window_expired");
  }
  const seconds=normalizeMeasuredBillableSeconds(current.publicRuntime!.activeMs/1000);
  const ack:PublicFinalizeAck={operation:"finalize",contractVersion:1,sessionId:current.id,deploymentId,
    ownerId,modelPolicyRevision:request.modelPolicyRevision,idempotencyKey:`finalize:${current.id}`,status:"ended",
    consumedSeconds:seconds,meterBasis:"server_observed_active_ms",stopWatermark:request.stopWatermark,finalizedAt:now.toISOString(),
    createdAt:current.createdAt,endedAt:current.publicRuntime!.stoppedAt!};
  const next=structuredClone(current);next.status="ended";next.endedAt=current.publicRuntime!.stoppedAt;
  next.lastActivityAt=next.endedAt;next.consumedSeconds=seconds;next.version=(current.version??1)+1;
  next.finalizationIdempotencyKey=ack.idempotencyKey;next.finalizedAt=ack.finalizedAt;
  next.publicFinalization={requestHash,ack};return {ack,next};
}
export async function finalizePublicSession(sessionId:string,ownerId:string,body:unknown,options:{now?:Date;serverRecovery?:boolean}={}) {
  publicDeploymentId();const request=parsePublicFinalize(body,sessionId),now=options.now??new Date();
  const runtime=getRepositoryRuntime();
  if(runtime.driver!=="postgres") return runStoreTransaction(()=>{
    const current=getStoreSnapshot().sessions.find(s=>s.id===sessionId);
    if(!current)throw new ResultSyncError("session_not_found",404);
    const result=plan(current,ownerId,request,now,options.serverRecovery===true);
    if(!result.next)return structuredClone(result.ack);
    if(findBillingLedgerEntryByIdempotencyKey(ownerId,`settle:${sessionId}`))throw new ResultSyncError("public_settlement_conflict");
    const ended=completeSessionWithUsageTransaction(sessionId,{billableSeconds:result.ack.consumedSeconds,
      endedAt:new Date(current.publicRuntime!.stoppedAt!)});
    if(!ended)throw new ResultSyncError("session_not_found",404);
    ended.publicFinalization=result.next.publicFinalization;ended.finalizationIdempotencyKey=result.ack.idempotencyKey;
    ended.finalizedAt=result.ack.finalizedAt;ended.version=(ended.version??1)+1;persistStoreSnapshot();
    return structuredClone(result.ack);
  });
  return withPostgresRepositoryFence({aggregateType:"communication_session",aggregateId:sessionId},async fence=>{
    for(let attempt=0;attempt<2;attempt++){
      const current=await runtime.postgres.sessions.find(sessionId);
      if(!current)throw new ResultSyncError("session_not_found",404);
      const result=plan(current,ownerId,request,now,options.serverRecovery===true);
      if(!result.next)return result.ack;
      const hash=repositoryRequestHash(request);
      const saved=await runtime.postgres.sessionCompletion.complete({sessionId,userId:ownerId,nextSession:result.next,
        expectedVersion:current.version,billableSeconds:result.ack.consumedSeconds,plan:await activePlanForUser(ownerId),
        idempotencyKey:`settle:${sessionId}`,commandId:repositoryCommandId({aggregateId:sessionId,
          operation:"public-finalize",version:current.version??1,requestHash:hash}),requestHash:hash,
        note:"realtime_session_usage",fence,now});
      if(saved.status==="completed")return saved.session.publicFinalization!.ack;
      if(saved.status==="already_ended" && saved.session.publicFinalization?.requestHash===resultSyncHash(request))return saved.session.publicFinalization.ack;
      if(saved.status!=="version_conflict")throw new ResultSyncError("public_settlement_conflict");
    }
    throw new ResultSyncError("public_finalization_version_conflict");
  });
}
export function serverFinalizationRequest(session:SessionRecord):PublicFinalizeRequest {
  return {operation:"finalize",contractVersion:1,sessionId:session.id,deploymentId:session.processingDeploymentId!,
    modelPolicyRevision:session.processingAuthorization!.modelPolicyRevision,idempotencyKey:`finalize:${session.id}`,
    stopWatermark:stopWatermark(session)};
}
