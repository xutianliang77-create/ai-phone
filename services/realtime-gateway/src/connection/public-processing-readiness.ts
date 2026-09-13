import type { GatewayDependencyReadiness } from "./gateway-dependency-readiness.js";
import type {RealtimeEnv} from "../config/env.js";
import {publicGatewayRuntimeBootstrapIssue} from "./public-runtime-bootstrap.js";
import { inspectPublicRuntimeLiveQualification,
  type PublicRuntimeComponent } from "@translation/platform-security";

/** Startup never sends a chargeable provider probe. A public session obtains its
 * exact configuration, authority and credentials from the API and must still
 * pass provider initialization at connection time. Private URLs never qualify it.
 */
export function publicProcessingReadiness(env:Pick<RealtimeEnv,
  "publicDeploymentId"|"publicRuntimeEnabled"|"publicCredentialAccessSecret"|"internalApiSecret"|"realtimeTokenSecret"|
  "publicLiveQualificationFile"|"publicLiveQualificationKey"|"publicConfigurationHash"|"publicModelPolicyRevision"|"publicActiveComponents">,now = new Date()): GatewayDependencyReadiness {
  const bootstrapIssue=publicGatewayRuntimeBootstrapIssue(env);
  const live=bootstrapIssue?undefined:liveQualification(env,now);
  const issue=bootstrapIssue??(live?.status==="not_ready"?live.issue:undefined)??"public_provider_live_qualification_required";
  if(live?.status==="ready"){
    const providers=new Map(live.evidence.providers.map(provider=>[provider.component,provider]));
    return {
      status:"ready",sessionReady:true,releaseReady:true,checkedAt:now.toISOString(),
      evidence:"signed_live_qualification",issues:[],warnings:[],
      services:live.evidence.components.map(component=>{
        const provider=providers.get(component)!;
        return {
          name:component,requiredForSession:true,requiredForRelease:true,status:"ready" as const,
          url:"",execution:"public" as const,
          identity:{providerId:provider.providerId,modelId:provider.modelId,
            evidenceId:live.evidence.evidenceId,expiresAt:live.evidence.expiresAt},
        };
      }),
    };
  }
  return {
    status: "not_ready", sessionReady: false, releaseReady: false,
    checkedAt: now.toISOString(), evidence: "implementation_gate",
    issues: [issue],
    warnings: [],
    services: (["asr", "translation", "tts"] as const).map(name => ({
      name, requiredForSession: true, requiredForRelease: true,
      status: "not_ready", url: "", execution: "public",
      issue,
    })),
  };
}

function liveQualification(env:Pick<RealtimeEnv,"publicDeploymentId"|"publicLiveQualificationFile"|"publicLiveQualificationKey"|"publicConfigurationHash"|"publicModelPolicyRevision"|"publicActiveComponents">,now:Date){
  if(!env.publicDeploymentId||!env.publicConfigurationHash||!env.publicModelPolicyRevision||!env.publicActiveComponents?.length){
    return {status:"not_ready" as const,issue:"public_runtime_live_qualification_not_configured"};
  }
  return inspectPublicRuntimeLiveQualification({file:env.publicLiveQualificationFile,signingKey:env.publicLiveQualificationKey,
    expectation:{deploymentId:env.publicDeploymentId,configurationHash:env.publicConfigurationHash,modelPolicyRevision:env.publicModelPolicyRevision,
      components:env.publicActiveComponents as PublicRuntimeComponent[]},now});
}
