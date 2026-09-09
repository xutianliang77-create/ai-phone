import {timingSafeEqual} from "node:crypto";
import type {FastifyInstance,FastifyRequest,FastifyReply} from "fastify";
import {isPublicAdmissionQuery,type PublicAdmissionQuery} from "@translation/contracts";
import {isInternalAuthorized} from "./realtime-route-validation.js";
import {queryPublicAdmission} from "./public-admission-query.service.js";
import {findSession} from "../sessions/sessions-runtime.repository.js";
import {createPublicModelCredentialResolver} from "../models/public-model-credential-resolver.js";
import {selectCurrentPublicModelConfiguration} from "../models/public-model-runtime-config.js";
import {ResultSyncError} from "../sessions/session-result-sync-contract.js";
import {PublicConfigError,type ModelComponent} from "../models/public-model-config.js";

/** Trusted boot-time capability. Never accepted from HTTP or the configuration UI.
 * Distinct from internal API and phone token signing secrets; no default enablement. */
export interface PublicGatewayCredentialAccess {secret:string;fetchFn?:typeof fetch;}
function authenticate(request:FastifyRequest,reply:FastifyReply){
  reply.header("cache-control","no-store").header("referrer-policy","no-referrer");
  if(!isInternalAuthorized(request.headers.authorization)){reply.code(401).send({error:{code:"internal_error"}});return false;}
  if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip)){reply.code(403).send({error:{code:"public_runtime_secure_transport_required"}});return false;}
  return true;
}
function failed(reply:FastifyReply,error:unknown){const known=error instanceof ResultSyncError||error instanceof PublicConfigError;
  return reply.code(known?error.status:503).send({error:{code:known?error.code:"public_runtime_material_unavailable"}});}
export function registerPublicRuntimeMaterialRoutes(app:FastifyInstance,access?:PublicGatewayCredentialAccess){
  const secret=access?.secret,fetchFn=access?.fetchFn;
  const resolvers=new Map<string,ReturnType<typeof createPublicModelCredentialResolver>>();
  if(access&&(!secret||secret.length<32||secret.length>4096||secret.trim()!==secret||/[\u0000-\u001f\u007f]/u.test(secret)||
    secret===process.env.INTERNAL_API_SECRET?.trim()||secret===process.env.REALTIME_TOKEN_SECRET))throw Error("public_gateway_credential_access_invalid");
  app.post("/internal/realtime/sessions/:sessionId/configuration",{bodyLimit:4096},async(request,reply)=>{
    if(!authenticate(request,reply))return;
    try{
      if(isPublicAdmissionQuery(request.body)&&request.body.purpose==="recovery")throw new ResultSyncError("public_recovery_material_denied",403);
      const {sessionId}=request.params as {sessionId:string},receipt=await queryPublicAdmission(sessionId,request.body),session=await findSession(sessionId);
      if(!session?.publicModelConfiguration||!session.publicRealtimeIssuance)throw new ResultSyncError("public_runtime_not_issued",403);
      selectCurrentPublicModelConfiguration(session.publicModelConfiguration,()=>undefined);
      return {receipt,configuration:structuredClone(session.publicModelConfiguration),authorization:structuredClone(session.publicRealtimeIssuance.claims.processing)};
    }catch(error){return failed(reply,error);}
  });
  app.post("/internal/realtime/sessions/:sessionId/credentials",{bodyLimit:4096},async(request,reply)=>{
    if(!authenticate(request,reply))return;
    if(!secret)return reply.code(503).send({error:{code:"public_gateway_credentials_not_enabled"}});
    const credential=request.headers["x-wujie-gateway-credential"];
    if(typeof credential!=="string"||Buffer.byteLength(credential)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(credential),Buffer.from(secret)))return reply.code(403).send({error:{code:"public_gateway_credential_denied"}});
    const stop=new AbortController(),abort=()=>stop.abort(),closed=()=>{if(!reply.raw.writableEnded)abort();};
    request.raw.once("aborted",abort);reply.raw.once("close",closed);
    try{
      const body=request.body as {query?:unknown;component?:unknown};
      if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==2||!isPublicAdmissionQuery(body.query)||!["asr","translation","tts"].includes(String(body.component)))throw new ResultSyncError("public_runtime_material_invalid",400);
      const query:PublicAdmissionQuery=body.query,component=body.component as ModelComponent,{sessionId}=request.params as {sessionId:string};
      if(query.purpose==="recovery")throw new ResultSyncError("public_recovery_material_denied",403);
      if(query.purpose==="connect"&&component!=="asr")throw new ResultSyncError("public_runtime_component_stage_denied",403);
      await queryPublicAdmission(sessionId,query);
      const session=await findSession(sessionId),snapshot=session?.publicModelConfiguration;
      if(!snapshot?.components[component]||snapshot.executionPlan[component].execution!=="public")throw new ResultSyncError("public_runtime_component_disabled",403);
      // OAuth stays in API; raw service-account/ADC JSON never crosses this boundary.
      const cacheKey=JSON.stringify([sessionId,query.leaseId,snapshot.configurationHash,component]);
      let resolve=resolvers.get(cacheKey);
      if(!resolve){if(resolvers.size>=256)resolvers.delete(resolvers.keys().next().value!);resolve=createPublicModelCredentialResolver(snapshot,component,{fetchFn});resolvers.set(cacheKey,resolve);}
      const value=await resolve(stop.signal);
      const receipt=await queryPublicAdmission(sessionId,query); // Recheck after asynchronous credential acquisition.
      selectCurrentPublicModelConfiguration(snapshot,()=>undefined);
      if(stop.signal.aborted)throw new ResultSyncError("public_runtime_material_cancelled",503);
      const credentials=Object.fromEntries(Object.entries(value).filter(([key])=>["apiKey","secretId","secretKey","accessToken","accessTokenExpiresAt","quotaProjectId"].includes(key)));
      return {receipt,component,credentials};
    }catch(error){return failed(reply,error);}
    finally{request.raw.off("aborted",abort);reply.raw.off("close",closed);}
  });
}
