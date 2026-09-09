import type {FastifyInstance} from "fastify";
import {requireAccount} from "../account/account-auth.js";
import {sendError} from "../../infrastructure/http/errors.js";
import {ResultSyncError} from "../sessions/session-result-sync-contract.js";
import {resolvePublicCreation} from "./public-creation-resolution.js";

export function registerPublicCreationResolutionRoutes(app:FastifyInstance,enabled:boolean) {
  for(const action of ["query","cancel","expire"] as const)app.post(`/realtime/creation-requests/${action}`,async(request,reply)=>{
    reply.header("cache-control","no-store").header("referrer-policy","no-referrer");
    const account=await requireAccount(request,reply);if(!account)return;
    if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip))return sendError(reply,403,"public_creation_secure_transport_required","Secure transport required");
    if(!enabled)return sendError(reply,503,"public_creation_not_enabled","Public creation is not enabled");
    try{return await resolvePublicCreation(account.id,request.headers["idempotency-key"],request.body,action);}
    catch(error){return sendError(reply,error instanceof ResultSyncError?error.status:503,error instanceof ResultSyncError?error.code:"public_creation_resolution_unavailable","Public creation resolution could not complete");}
  });
}
