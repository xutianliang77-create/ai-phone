import type {FastifyRequest,FastifyReply} from "fastify";
import {sendError} from "../../infrastructure/http/errors.js";
import {ResultSyncError} from "../sessions/session-result-sync-contract.js";
import {PublicConfigError} from "../models/public-model-config.js";
import type {PublicRealtimeCoordinator} from "./public-realtime-coordinator.js";

export async function handlePublicRealtimeCreation(request:FastifyRequest,reply:FastifyReply,ownerId:string,coordinate:PublicRealtimeCoordinator){
  reply.header("cache-control","no-store").header("referrer-policy","no-referrer");
  if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip))return sendError(reply,403,"public_creation_secure_transport_required","Secure transport required");
  const stop=new AbortController(),abort=()=>stop.abort(),closed=()=>{if(!reply.raw.writableEnded)abort();};
  request.raw.once("aborted",abort);reply.raw.once("close",closed);
  try{return await coordinate(ownerId,request.headers["idempotency-key"],request.body,stop.signal);}
  catch(error){
    const known=error instanceof ResultSyncError||error instanceof PublicConfigError;
    return sendError(reply,known?error.status:503,known?error.code:"public_creation_unavailable","Public session creation was not authorized or could not complete");
  }finally{request.raw.off("aborted",abort);reply.raw.off("close",closed);}
}
