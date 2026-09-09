import {getStoreSnapshot,persistStoreSnapshot,runStoreTransaction} from "../../infrastructure/storage/json-store.js";
import {getRepositoryRuntime} from "../../infrastructure/storage/repository-runtime.js";
import {withSessionWriteLock} from "../sessions/session-write-coordinator.js";
import {assertPublicSession} from "../sessions/session-result-sync.service.js";
import {ResultSyncError,resultSyncHash,syncKey} from "../sessions/session-result-sync-contract.js";
import {releaseUsageHold} from "../usage/usage.service.js";
import {publicCreationIdentity} from "./public-creation-binding.js";
import {publicCreationInput} from "./public-realtime-preparation.js";

/** Same original snapshot and user quota hold; never settles usage, clears model
 * attempts, refunds supplier costs or revokes an external budget reservation.
 * Only a creation with no runtime/output/accounting evidence can be retired. */
export async function resolvePublicCreation(ownerId:string,key:unknown,value:unknown,action:"query"|"cancel"|"expire",now=new Date()) {
  if(getRepositoryRuntime().driver==="postgres")throw new ResultSyncError("public_creation_postgres_idempotency_not_ready",503);
  const b=value as {request?:unknown;nonce?:unknown}|null;
  if(!b||Array.isArray(b)||Object.keys(b).some(k=>!["request","nonce"].includes(k))||!syncKey(b.nonce)||!Number.isFinite(now.getTime()))throw new ResultSyncError("public_creation_resolution_invalid",400);
  const {deploymentId,sessionId}=publicCreationIdentity(ownerId,key);
  // Parse the original body without requiring today's model configuration: a
  // rotated or disabled configuration must not strand an older pending request.
  const requestHash=resultSyncHash(publicCreationInput(b.request));
  const responseBinding={contractVersion:1,sessionId,ownerId,deploymentId,nonce:b.nonce,requestHash:resultSyncHash(b.request)};
  return withSessionWriteLock(`public-create:${sessionId}`,()=>withSessionWriteLock(sessionId,()=>runStoreTransaction(()=>{
    const store=getStoreSnapshot(),binding=store.publicCreationBindings?.[sessionId],current=store.sessions.find(s=>s.id===sessionId);
    if(binding&&binding.replace(/^(cancelled|expired):/,"")!==requestHash)throw new ResultSyncError("public_creation_request_conflict",409);
    if(current){
      assertPublicSession(current,ownerId,deploymentId);
      if(current.publicCreationRequest?.requestHash!==requestHash||resultSyncHash(current.publicCreationRequest.request)!==requestHash||!binding)throw new ResultSyncError("public_creation_binding_changed",409);
    }
    const holds=store.usageHolds.filter(h=>h.sessionId===sessionId);
    const accounted=store.billingLedger.some(e=>e.sessionId===sessionId);
    const runtime=!!current&&(!!current.publicRuntime||!!current.publicFinalization||!!current.finalizedAt||!!current.finalizationIdempotencyKey||
      !!current.publicModelAttempts?.length||current.segments.length>0||current.consumedSeconds!==0);
    const inconsistentHold=holds.length>1||holds.some(h=>h.userId!==ownerId||!["active","released"].includes(h.status));
    const retired=binding?.startsWith("cancelled:")?"cancelled":binding?.startsWith("expired:")?"expired":null;
    const unsafe=runtime||accounted||inconsistentHold||(!current&&!!binding&&!retired)||(!current&&holds.length>0)||
      (!!current&&!retired&&current.status!=="created");
    if(retired){
      if(unsafe||holds.some(h=>h.status==="active")||current&&current.status!=="failed")throw new ResultSyncError("public_creation_retirement_inconsistent",409);
      return {...responseBinding,state:retired,safeToReplace:true,canRetire:false};
    }
    if(unsafe){
      if(action!=="query")throw new ResultSyncError("public_creation_runtime_reconciliation_required",409);
      return {...responseBinding,state:"reconciliation_required",safeToReplace:false,canRetire:false};
    }
    const expiry=current?current.publicRealtimeIssuance?current.publicRealtimeIssuance.claims.expiresAt*1000:Date.parse(current.createdAt)+300000:null;
    if(expiry!==null&&!Number.isFinite(expiry))throw new ResultSyncError("public_creation_expiry_invalid",409);
    const expired=expiry!==null&&now.getTime()>=expiry;
    if(action==="query")return {...responseBinding,state:!current?"not_found":expired?"expired_pending":current.publicRealtimeIssuance?"issued":"prepared",
      safeToReplace:false,canRetire:true,...(expiry!==null?{expiresAt:new Date(expiry).toISOString()}:{})};
    if(action==="expire"&&!expired)throw new ResultSyncError("public_creation_not_expired",409);
    const state=action==="expire"?"expired":"cancelled";
    // No awaits inside this transaction: a first runtime observation cannot race
    // the eligibility check, terminal fence and release. The outer create lock
    // serializes against issuance/late authority responses in this process.
    if(current){
      current.status="failed";current.endedAt=now.toISOString();current.version=(current.version??1)+1;
      if(current.publicInferenceAdmission)current.publicInferenceAdmission.revokedAt=now.toISOString();
      releaseUsageHold(ownerId,sessionId);
    }
    store.publicCreationBindings??={};store.publicCreationBindings[sessionId]=`${state}:${requestHash}`;
    persistStoreSnapshot();
    return {...responseBinding,state,safeToReplace:true,canRetire:false};
  })));
}
