import type {FastifyInstance,FastifyRequest,FastifyReply} from "fastify";
import {isInternalAuthorized} from "../realtime/realtime-route-validation.js";
import {publicModelCatalog,emptyConfiguration,publicConfiguration,PublicConfigError} from "./public-model-config.js";
import {readPublicModelConfiguration,savePublicModelConfiguration} from "./public-model-config-store.js";
import {capturePublicModelRuntimeConfiguration,type PublicModelRuntimeSnapshot} from "./public-model-runtime-config.js";
import type {PublicRealtimeAuthority} from "../realtime/public-realtime-coordinator.js";
import {publicModelConfigPage,publicModelConfigScript,modelConfigPage} from "./public-model-config-page.js";
import {privateModelCatalog,emptyPrivateConfiguration,privateConfiguration,readPrivateModelConfiguration,savePrivateModelConfiguration} from "./private-model-config.js";
function headers(reply:FastifyReply){reply.header("cache-control","no-store").header("x-content-type-options","nosniff").header("referrer-policy","no-referrer");}
function authorize(request:FastifyRequest,reply:FastifyReply){
  headers(reply);
  if(!isInternalAuthorized(request.headers.authorization)){reply.code(401).send({error:{code:"config_admin_required"}});return false;}
  if(request.protocol!=="https"&&!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.ip)){reply.code(403).send({error:{code:"config_secure_transport_required"}});return false;}
  return true;
}
async function result(reply:FastifyReply,run:()=>unknown){try{return await run();}catch(e){return reply.code(e instanceof PublicConfigError?e.status:503).send({error:{code:e instanceof PublicConfigError?e.code:"public_config_storage_error"}});}}
export function registerPublicModelConfigurationRoutes(app:FastifyInstance,capability?:PublicRealtimeAuthority["configurationCapability"]){
  app.get("/models/private-config",async(_request,reply)=>{
    headers(reply);reply.header("content-security-policy","default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return reply.type("text/html; charset=utf-8").send(modelConfigPage("private"));
  });
  app.get("/models/private-config/editor.js",async(_request,reply)=>{headers(reply);return reply.type("application/javascript; charset=utf-8").send(publicModelConfigScript);});
  app.get("/models/private-config/catalog",async(_request,reply)=>{headers(reply);return {...privateModelCatalog,defaults:privateConfiguration(emptyPrivateConfiguration("unconfigured"))};});
  app.get("/models/private-config/data",async(request,reply)=>{if(!authorize(request,reply))return;return result(reply,()=>readPrivateModelConfiguration());});
  app.put("/models/private-config/data",{bodyLimit:256*1024},async(request,reply)=>{if(!authorize(request,reply))return;return result(reply,()=>savePrivateModelConfiguration(request.body));});
  app.get("/models/public-config",async(_request,reply)=>{
    headers(reply);reply.header("content-security-policy","default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return reply.type("text/html; charset=utf-8").send(publicModelConfigPage);
  });
  app.get("/models/public-config/editor.js",async(_request,reply)=>{headers(reply);return reply.type("application/javascript; charset=utf-8").send(publicModelConfigScript);});
  app.get("/models/public-config/catalog",async(_request,reply)=>{headers(reply);return {...publicModelCatalog,defaults:publicConfiguration(emptyConfiguration("unconfigured"))};});
  app.get("/models/public-config/data",async(request,reply)=>{if(!authorize(request,reply))return;return result(reply,()=>readPublicModelConfiguration());});
  app.get("/models/public-config/status",async(request,reply)=>{
    if(!authorize(request,reply))return;
    return result(reply,()=>{
      const saved=readPublicModelConfiguration();
      const mode=(voiceOutput:boolean)=>{
        let snapshot:PublicModelRuntimeSnapshot;
        try{snapshot=capturePublicModelRuntimeConfiguration(voiceOutput);}
        catch(error){return {status:"not_configured",reason:error instanceof PublicConfigError?error.code:"public_runtime_config_unavailable"};}
        return {status:capability?.(snapshot).status==="qualified"?"qualified":"not_qualified",
          configurationHash:snapshot.configurationHash,modelPolicyRevision:snapshot.modelPolicyRevision};
      };
      return {deploymentId:saved.deploymentId,configurationRevision:saved.revision,
        silent:mode(false),spoken:mode(true)};
    });
  });
  app.put("/models/public-config/data",{bodyLimit:256*1024},async(request,reply)=>{
    if(!authorize(request,reply))return;
    // An active public runtime has only the latest encrypted credential set.
    // Switching it mid-session would invalidate the original supplier session.
    if(process.env.PUBLIC_RUNTIME_ENABLED?.trim().toLowerCase()==="true")return reply.code(409).send({error:{code:"public_config_maintenance_required"}});
    return result(reply,()=>savePublicModelConfiguration(request.body));
  });
}
