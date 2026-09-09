import type {FastifyInstance} from "fastify";
import {requireAccount} from "../account/account-auth.js";
import {capturePublicModelRuntimeConfiguration} from "../models/public-model-runtime-config.js";
import {publicDeploymentId} from "../sessions/session-result-sync.service.js";
import {PublicConfigError} from "../models/public-model-config.js";
import {publicProtocolCapability} from "@translation/contracts";

/** Authenticated mobile request context, not the administrator model catalogue.
 * No model URLs, keys, grant, provider budget or inference are exposed/created. */
export function registerPublicCreationContextRoute(app:FastifyInstance,available:boolean){
  app.get("/realtime/sessions/configuration",async(request,reply)=>{
    reply.header("cache-control","no-store");
    const account=await requireAccount(request,reply);if(!account)return;
    if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip))return reply.code(403).send({error:{code:"public_creation_secure_transport_required"}});
    const q=request.query as Record<string,unknown>;
    if(Object.keys(q).length!==1||!["true","false"].includes(String(q.voiceOutput)))return reply.code(400).send({error:{code:"public_creation_voice_required"}});
    if(!available)return reply.code(503).send({error:{code:"public_creation_not_ready"}});
    try{
      const voiceOutput=q.voiceOutput==="true",configuration=capturePublicModelRuntimeConfiguration(voiceOutput),deploymentId=publicDeploymentId();
      if(publicProtocolCapability(configuration.components.asr!.protocol)?.input!=="continuous_pcm")throw new PublicConfigError("public_creation_asr_not_continuous",503);
      const endpoint=new URL(process.env.REALTIME_WS_ENDPOINT??"");
      if(endpoint.protocol!=="wss:"||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error("endpoint");
      return {contractVersion:1,deploymentId,ownerId:account.id,configurationRevision:configuration.configurationRevision,
        modelPolicyRevision:configuration.modelPolicyRevision,executionPlan:configuration.executionPlan,captureSampleRate:configuration.components.asr!.sampleRate,
        endpoint:endpoint.toString(),voiceOutput,...(voiceOutput?{voicePresetId:configuration.components.tts!.voice}:{}),
        status:"configured_not_verified",limitations:["fixed_language_only","configured_voice_only","speaker_and_termbase_not_supported","reconnect_not_supported"]};
    }catch(error){return reply.code(error instanceof PublicConfigError?error.status:503).send({error:{code:error instanceof PublicConfigError?error.code:"public_creation_context_unavailable"}});}
  });
}
