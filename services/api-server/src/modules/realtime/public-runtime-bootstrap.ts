import type {PublicGatewayCredentialAccess} from "./public-runtime-material.routes.js";

type RuntimeEnv=Pick<NodeJS.ProcessEnv,"API_RESULT_SYNC_DEPLOYMENT_ID"|"PUBLIC_RUNTIME_ENABLED"|"PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET"|"INTERNAL_API_SECRET"|"REALTIME_TOKEN_SECRET">;
const deployment=(value:unknown)=>typeof value==="string"&&/^[A-Za-z0-9._-]{1,120}$/.test(value);
const enabled=(value:unknown)=>typeof value==="string"&&value.trim().toLowerCase()==="true";

/**
 * Normal API boot may expose public credential-material routes only when the
 * same independently scoped Gateway secret is explicitly enabled. This does
 * not install a creation authority, read model credentials, or call a model.
 */
export function publicGatewayCredentialAccessFromEnvironment(env:RuntimeEnv=process.env):PublicGatewayCredentialAccess|undefined{
  if(!enabled(env.PUBLIC_RUNTIME_ENABLED))return undefined;
  if(!deployment(env.API_RESULT_SYNC_DEPLOYMENT_ID))throw Error("public_deployment_not_configured");
  const secret=env.PUBLIC_GATEWAY_CREDENTIAL_ACCESS_SECRET;
  if(typeof secret!=="string"||secret.length<32||secret.length>4096||secret.trim()!==secret||/[\u0000-\u001f\u007f]/u.test(secret)||
    secret===env.INTERNAL_API_SECRET?.trim()||secret===env.REALTIME_TOKEN_SECRET?.trim())throw Error("public_gateway_credential_access_invalid");
  return {secret};
}
