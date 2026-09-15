import {publicRuntimeTokenBinding,type CreateRealtimeSessionResponse,type RealtimeTokenClaims} from "@translation/contracts";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {withSessionWriteLock} from "../sessions/session-write-coordinator.js";
import {publicDeploymentId,mutatePublicSession} from "../sessions/session-result-sync.service.js";
import {ResultSyncError,resultSyncHash,syncKey} from "../sessions/session-result-sync-contract.js";
import {verifiedPublicAdmission,issuePublicRuntimeLease} from "../sessions/public-runtime-admission.js";
import {createUsageHold,releaseUsageHold} from "../usage/usage-hold-runtime.service.js";
import {preparedPublicSession} from "./public-realtime-preparation.js";
import {createRealtimeToken} from "./realtime-token.js";
import {realtimeMaxSessionSeconds} from "./realtime-session-duration.js";

function issuerSettings(){
  const secret=process.env.REALTIME_TOKEN_SECRET,endpoint=process.env.REALTIME_WS_ENDPOINT;
  if(!secret||secret.length<32||secret.length>4096||secret.trim()!==secret||/[\u0000-\u001f\u007f]/u.test(secret))throw new ResultSyncError("public_issuer_signing_not_configured",503);
  let url:URL;try{url=new URL(endpoint??"");}catch{throw new ResultSyncError("public_issuer_endpoint_not_configured",503);}
  if(url.protocol!=="wss:"||url.username||url.password||url.search||url.hash)throw new ResultSyncError("public_issuer_endpoint_not_configured",503);
  return {secret,endpoint:url.toString(),deploymentId:publicDeploymentId()};
}

/** Internal phase AFTER independent server producers persisted and verified
 * inference consent, supplier budget and model qualification. No HTTP wiring.
 * Original usage hold and signing are reused; this function never creates grants.
 * Uncertain failures retain the same bounded hold/lease for retry, never release
 * another issuer's reservation or silently create a fresh chargeable session. */
export async function issuePublicRealtimeSession(sessionId:string,ownerId:string):Promise<CreateRealtimeSessionResponse> {
  if(![sessionId,ownerId].every(syncKey))throw new ResultSyncError("public_creation_invalid",400);
  const settings=issuerSettings();
  return withSessionWriteLock(sessionId,async()=>{
    const before=await findSession(sessionId);
    if(!before)throw new ResultSyncError("session_not_found",404);
    preparedPublicSession(before,ownerId);verifiedPublicAdmission(before,ownerId,new Date());
    const lease=await issuePublicRuntimeLease(sessionId,ownerId),remaining=Math.floor((Date.parse(lease.expiresAt)-Date.now())/1000);
    if(remaining<1)throw new ResultSyncError("public_inference_admission_expired",403);
    // Server-side account accounting may reserve a short start hold, but it is
    // never exposed as a public-session duration or client-side quota contract.
    const holdSeconds=Math.min(30,lease.maxActiveSeconds??30,realtimeMaxSessionSeconds());
    const hold=await createUsageHold(ownerId,holdSeconds,{sessionId,idempotencyKey:`hold:${sessionId}`,note:"realtime_session_hold",ttlSeconds:remaining});
    // The legacy idempotent API can return a released/settled hold as 'held'.
    if(hold.status!=="held")throw new ResultSyncError("quota_not_enough",402);
    if(hold.hold.status!=="active"||hold.hold.userId!==ownerId||hold.hold.sessionId!==sessionId||hold.hold.seconds!==holdSeconds||
      Date.parse(hold.hold.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(hold.hold.expiresAt)))throw new ResultSyncError("public_issuer_hold_invalid",409);
    let issuance:{requestHash:string;endpoint:string;claims:RealtimeTokenClaims;holdId:string};
    try{
      // The hold is created in its own durable aggregate. Re-read the public
      // session before recording issuance so a concurrent cancellation cannot
      // leave a newly reserved hold attached to a retired creation request.
      const beforeIssuance=await findSession(sessionId);
      if(!beforeIssuance)throw new ResultSyncError("session_not_found",404);
      preparedPublicSession(beforeIssuance,ownerId);
      issuance=await mutatePublicSession(sessionId,"public-realtime-issue",{ownerId},current=>{
        const {input,config}=preparedPublicSession(current,ownerId);
        verifiedPublicAdmission(current,ownerId,new Date());
        if(resultSyncHash(current.publicRuntimePolicy)!==resultSyncHash(lease)||resultSyncHash(issuerSettings())!==resultSyncHash(settings))throw new ResultSyncError("public_issuer_binding_changed");
        const old=current.publicRealtimeIssuance,issuedAt=old?.claims.issuedAt??Math.floor(Date.now()/1000);
        const expiresAt=Math.min(issuedAt+300,Math.floor(Date.parse(lease.expiresAt)/1000));
        if(expiresAt<=Math.floor(Date.now()/1000))throw new ResultSyncError("public_issuer_expired",403);
        const maxDurationSeconds=lease.maxActiveSeconds===undefined?undefined:Math.min(realtimeMaxSessionSeconds(),lease.maxActiveSeconds,Math.floor(Date.parse(lease.expiresAt)/1000)-issuedAt);
        const claims:RealtimeTokenClaims={userId:ownerId,sessionId,mode:input.mode,asrEndpointMode:["meeting","classroom"].includes(input.mode)?"listening":"conversation",
          sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage,voiceOutput:input.voiceOutput,
          ...(input.autoReverseTargetLanguage?{autoReverseTargetLanguage:true}:{}),
          ...(input.voiceOutput?{voice:{mode:"preset",presetId:config.components.tts!.voice}}:{}),planCode:hold.balance.planCode,
          ...(maxDurationSeconds!==undefined?{maxDurationSeconds}:{}),issuedAt,expiresAt,processing:structuredClone(current.processingAuthorization!),
          publicRuntime:{deploymentId:settings.deploymentId,leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,
            sampleRate:lease.sampleRate!,configurationRevision:config.configurationRevision,configurationHash:config.configurationHash}};
        if(!publicRuntimeTokenBinding(claims,settings.deploymentId)||createRealtimeToken(claims,settings.secret).length>4096)throw new ResultSyncError("public_issuer_token_invalid",503);
        const record={requestHash:current.publicCreationRequest!.requestHash,endpoint:settings.endpoint,claims,holdId:hold.hold.id};
        if(old){if(resultSyncHash(old)!==resultSyncHash(record))throw new ResultSyncError("public_issuer_retry_conflict");return {next:null,result:structuredClone(old)};}
        const next=structuredClone(current);next.publicRealtimeIssuance=record;
        return {next,result:record};
      });
    }catch(error){
      const current=await findSession(sessionId);
      if(current?.publicCreationRetirement&&current.userId===ownerId){
        try{await releaseUsageHold(ownerId,sessionId);}catch{throw new ResultSyncError("public_creation_hold_reconciliation_required",409);}
      }
      throw error;
    }
    // Sign only the committed projection; token bytes are never persisted.
    const committedIssuance=issuance!;
    const claims=committedIssuance.claims;
    if(claims.expiresAt<=Math.floor(Date.now()/1000))throw new ResultSyncError("public_issuer_expired",403);
    if(resultSyncHash(issuerSettings())!==resultSyncHash(settings))throw new ResultSyncError("public_issuer_binding_changed");
    return {sessionId,realtimeToken:createRealtimeToken(claims,settings.secret),endpoint:committedIssuance.endpoint,
      expiresAt:new Date(claims.expiresAt*1000).toISOString(),...(claims.maxDurationSeconds!==undefined?{maxDurationSeconds:claims.maxDurationSeconds}:{}),
      captureSampleRate:claims.publicRuntime!.sampleRate,deploymentId:claims.publicRuntime!.deploymentId,ownerId,
      processing:structuredClone(claims.processing!)};
  });
}
