import {publicModelComponents,publicRuntimeTokenBinding,type RealtimeTokenClaims} from "@translation/contracts";
import type {RealtimeEnv} from "../config/env.js";
import type {GatewayDependencyReadiness} from "./gateway-dependency-readiness.js";
import {publicProcessingReadiness} from "./public-processing-readiness.js";

/** Call only after signature/expiry verification. The monitor's static scope
 * describes deployment health, not the effective components of every session.
 * Reuse the same signed-evidence reader for the token-bound snapshot; the API
 * must still recheck the stored grant/config before any credential access. */
export function publicSessionReadinessForVerifiedClaims(
  env:RealtimeEnv,claims:RealtimeTokenClaims,current:GatewayDependencyReadiness|undefined,now=new Date(),
):GatewayDependencyReadiness|undefined {
  // Preserve the explicit in-process test injection and initial/foreign
  // dependency gates. Neither path manufactures a signed qualification.
  if(!current||!current.evidence)return current;
  const binding=env.publicDeploymentId?publicRuntimeTokenBinding(claims,env.publicDeploymentId):null;
  if(!binding)return {...current,status:"not_ready",sessionReady:false,releaseReady:false,
    issues:["public_runtime_token_binding_invalid"],services:[]};
  return publicProcessingReadiness({...env,
    publicConfigurationHash:binding.configurationHash,
    publicModelPolicyRevision:claims.processing!.modelPolicyRevision,
    publicActiveComponents:publicModelComponents(claims.processing!.executionPlan),
  },now);
}
