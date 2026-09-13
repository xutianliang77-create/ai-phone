import type {RealtimeEnv} from "../config/env.js";
import type {PublicGatewayRuntimeOptions} from "./configured-public-connection.js";

/**
 * Production bootstrap is deliberately separate from model configuration.
 * It neither reads provider credentials nor probes a provider, and default-off
 * prevents a deployment identity alone from exposing the public entry path.
 */
export function publicGatewayRuntimeBootstrapIssue(env:Pick<RealtimeEnv,
  "publicDeploymentId"|"publicRuntimeEnabled"|"publicCredentialAccessSecret"|"internalApiSecret"|"realtimeTokenSecret">){
  if(!env.publicDeploymentId)return "public_deployment_not_configured";
  if(!env.publicRuntimeEnabled)return "public_runtime_disabled";
  const secret=env.publicCredentialAccessSecret;
  if(typeof secret!=="string"||secret.length<32||secret.trim()!==secret||/[\u0000-\u001f\u007f]/u.test(secret))return "public_credential_access_required";
  if(secret===env.internalApiSecret||secret===env.realtimeTokenSecret)return "public_credential_access_must_be_independent";
  return undefined;
}

/** Returns only the independently scoped material-access secret, never provider credentials. */
export function publicGatewayRuntimeOptions(env:Pick<RealtimeEnv,
  "publicDeploymentId"|"publicRuntimeEnabled"|"publicCredentialAccessSecret"|"internalApiSecret"|"realtimeTokenSecret">):PublicGatewayRuntimeOptions|undefined{
  if(publicGatewayRuntimeBootstrapIssue(env))return undefined;
  return {credentialAccessSecret:env.publicCredentialAccessSecret!};
}
