import type {FastifyInstance,FastifyReply} from "fastify";
import {requireAccount} from "../account/account-auth.js";
import {sendError} from "../../infrastructure/http/errors.js";
import {withSessionWriteLock} from "../sessions/session-write-coordinator.js";
import {ResultSyncError} from "../sessions/session-result-sync-contract.js";
import {observePublicRuntime,publicRecoveryStatus} from "../sessions/public-session-runtime.service.js";
import {finalizePublicSession,serverFinalizationRequest} from "../sessions/public-session-finalization.service.js";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {isInternalAuthorized} from "./realtime-route-validation.js";
import {recordPublicModelAttempt} from "../sessions/public-model-attempt.service.js";
import {queryPublicAdmission} from "./public-admission-query.service.js";
import {PublicConfigError} from "../models/public-model-config.js";
import {claimPublicRecoveryOwnership} from "../sessions/public-recovery-ownership.service.js";

export function registerPublicLifecycleRoutes(app:FastifyInstance){
  app.post("/internal/realtime/sessions/:sessionId/admission",{bodyLimit:4096},async(request,reply)=>{
    reply.header("cache-control","no-store");
    if(!isInternalAuthorized(request.headers.authorization))return sendError(reply,401,"internal_error","Unauthorized internal request");
    if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip))return sendError(reply,403,"public_admission_secure_transport_required","Secure transport required");
    const {sessionId}=request.params as {sessionId:string};
    try{return await queryPublicAdmission(sessionId,request.body);}
    catch(error){const known=error instanceof ResultSyncError||error instanceof PublicConfigError;
      return sendError(reply,known?error.status:503,known?error.code:"public_admission_unavailable","Current public admission could not be confirmed");}
  });
  app.post("/internal/realtime/sessions/:sessionId/model-attempts",{bodyLimit:4096},async(request,reply)=>{
    if(!isInternalAuthorized(request.headers.authorization))return sendError(reply,401,"internal_error","Unauthorized internal request");
    const {sessionId}=request.params as {sessionId:string};
    return lifecycleResponse(reply,()=>withSessionWriteLock(sessionId,()=>recordPublicModelAttempt(sessionId,request.body)));
  });
  app.get("/realtime/sessions/:sessionId/recovery",async(request,reply)=>{
    const account=await requireAccount(request,reply);if(!account)return;
    const {sessionId}=request.params as {sessionId:string};
    return lifecycleResponse(reply,()=>publicRecoveryStatus(sessionId,account.id));
  });
  app.post("/internal/realtime/sessions/:sessionId/runtime",{bodyLimit:4096},async(request,reply)=>{
    if(!isInternalAuthorized(request.headers.authorization))return sendError(reply,401,"internal_error","Unauthorized internal request");
    const {sessionId}=request.params as {sessionId:string};
    return lifecycleResponse(reply,()=>withSessionWriteLock(sessionId,async()=>{
      const evidence=await observePublicRuntime(sessionId,request.body);
      const session=await findSession(sessionId);
      if(!session)throw new ResultSyncError("session_not_found",404);
      if(evidence.phase==="stopped"){
        await finalizePublicSession(sessionId,session.userId,serverFinalizationRequest(session),{serverRecovery:true});
      }
      const policy=session.publicRuntimePolicy!;
      return {sessionId,deploymentId:session.processingDeploymentId,ownerId:session.userId,
        modelPolicyRevision:session.processingAuthorization!.modelPolicyRevision,
        leaseId:policy.leaseId,captureId:policy.captureId,languagePolicyKey:policy.languagePolicyKey,
        sequence:evidence.sequence,phase:evidence.phase,finalRevision:evidence.finalRevision,
        lastAcceptedSample:evidence.lastAcceptedSample,meterStatus:evidence.uncertain?"uncertain":"verified"};
    }));
  });
  app.post("/internal/realtime/sessions/:sessionId/recovery-ownership",{bodyLimit:1024},async(request,reply)=>{
    if(!isInternalAuthorized(request.headers.authorization))return sendError(reply,401,"internal_error","Unauthorized internal request");
    if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip))return sendError(reply,403,"public_recovery_secure_transport_required","Secure transport required");
    const {sessionId}=request.params as {sessionId:string};
    return lifecycleResponse(reply,async()=>{
      const ownership=await claimPublicRecoveryOwnership(sessionId,request.body);
      return {sessionId,...ownership};
    });
  });
}
export function handlePublicFinalization(reply:FastifyReply,sessionId:string,ownerId:string,body:unknown){
  return lifecycleResponse(reply,()=>withSessionWriteLock(sessionId,()=>finalizePublicSession(sessionId,ownerId,body)));
}
async function lifecycleResponse(reply:FastifyReply,action:()=>Promise<unknown>){
  try{return await action();}catch(error){
    if(error instanceof ResultSyncError)return sendError(reply,error.status,error.code,error.message);
    throw error;
  }
}
