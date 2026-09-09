import {publicRuntimeTokenBinding,type CreateRealtimeSessionResponse,type RealtimeTokenClaims} from "@translation/contracts";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {withSessionWriteLock} from "../sessions/session-write-coordinator.js";
import {publicDeploymentId,mutatePublicSession} from "../sessions/session-result-sync.service.js";
import {ResultSyncError,resultSyncHash,syncKey} from "../sessions/session-result-sync-contract.js";
import {verifiedPublicAdmission,issuePublicRuntimeLease} from "../sessions/public-runtime-admission.js";
import {createUsageHold} from "../usage/usage-hold-runtime.service.js";
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
    const holdSeconds=Math.min(30,lease.maxActiveSeconds,realtimeMaxSessionSeconds());
    const hold=await createUsageHold(ownerId,holdSeconds,{sessionId,idempotencyKey:`hold:${sessionId}`,note:"realtime_session_hold",ttlSeconds:remaining});
    // The legacy idempotent API can return a released/settled hold as 'held'.
    if(hold.status!=="held")throw new ResultSyncError("quota_not_enough",402);
    if(hold.hold.status!=="active"||hold.hold.userId!==ownerId||hold.hold.sessionId!==sessionId||hold.hold.seconds!==holdSeconds||
      Date.parse(hold.hold.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(hold.hold.expiresAt)))throw new ResultSyncError("public_issuer_hold_invalid",409);
    const issuance=await mutatePublicSession(sessionId,"public-realtime-issue",{ownerId},current=>{
      const {input,config}=preparedPublicSession(current,ownerId);
      verifiedPublicAdmission(current,ownerId,new Date());
      if(resultSyncHash(current.publicRuntimePolicy)!==resultSyncHash(lease)||resultSyncHash(issuerSettings())!==resultSyncHash(settings))throw new ResultSyncError("public_issuer_binding_changed");
      const old=current.publicRealtimeIssuance,issuedAt=old?.claims.issuedAt??Math.floor(Date.now()/1000);
      const expiresAt=Math.min(issuedAt+300,Math.floor(Date.parse(lease.expiresAt)/1000));
      if(expiresAt<=Math.floor(Date.now()/1000))throw new ResultSyncError("public_issuer_expired",403);
      const maxDurationSeconds=Math.min(realtimeMaxSessionSeconds(),lease.maxActiveSeconds,Math.floor(Date.parse(lease.expiresAt)/1000)-issuedAt);
      const claims:RealtimeTokenClaims={userId:ownerId,sessionId,mode:input.mode,asrEndpointMode:["meeting","classroom"].includes(input.mode)?"listening":"conversation",
        sourceLanguage:input.sourceLanguage,targetLanguage:input.targetLanguage,voiceOutput:input.voiceOutput,
        ...(input.voiceOutput?{voice:{mode:"preset",presetId:config.components.tts!.voice}}:{}),planCode:hold.balance.planCode,
        maxDurationSeconds,holdSeconds,issuedAt,expiresAt,processing:structuredClone(current.processingAuthorization!),
        publicRuntime:{deploymentId:settings.deploymentId,leaseId:lease.leaseId,captureId:lease.captureId,languagePolicyKey:lease.languagePolicyKey,
          sampleRate:lease.sampleRate!,configurationRevision:config.configurationRevision,configurationHash:config.configurationHash}};
      if(!publicRuntimeTokenBinding(claims,settings.deploymentId)||createRealtimeToken(claims,settings.secret).length>4096)throw new ResultSyncError("public_issuer_token_invalid",503);
      const record={requestHash:current.publicCreationRequest!.requestHash,endpoint:settings.endpoint,claims,holdId:hold.hold.id};
      if(old){if(resultSyncHash(old)!==resultSyncHash(record))throw new ResultSyncError("public_issuer_retry_conflict");return {next:null,result:structuredClone(old)};}
      const next=structuredClone(current);next.publicRealtimeIssuance=record;
      return {next,result:record};
    });
    // Sign only the committed projection; token bytes are never persisted.
    const claims=issuance.claims;
    if(claims.expiresAt<=Math.floor(Date.now()/1000))throw new ResultSyncError("public_issuer_expired",403);
    if(resultSyncHash(issuerSettings())!==resultSyncHash(settings))throw new ResultSyncError("public_issuer_binding_changed");
    return {sessionId,realtimeToken:createRealtimeToken(claims,settings.secret),endpoint:issuance.endpoint,
      expiresAt:new Date(claims.expiresAt*1000).toISOString(),maxDurationSeconds:claims.maxDurationSeconds,
      captureSampleRate:claims.publicRuntime!.sampleRate,deploymentId:claims.publicRuntime!.deploymentId,ownerId,
      processing:structuredClone(claims.processing!)};
  });
}
