import type { GatewayDependencyReadiness } from "./gateway-dependency-readiness.js";
import type {RealtimeEnv} from "../config/env.js";
import {publicGatewayRuntimeBootstrapIssue} from "./public-runtime-bootstrap.js";

/** Startup never sends a chargeable provider probe. A public session obtains its
 * exact configuration, authority and credentials from the API and must still
 * pass provider initialization at connection time. Private URLs never qualify it.
 */
export function publicProcessingReadiness(env:Pick<RealtimeEnv,
  "publicDeploymentId"|"publicRuntimeEnabled"|"publicCredentialAccessSecret"|"internalApiSecret"|"realtimeTokenSecret">,now = new Date()): GatewayDependencyReadiness {
  const bootstrapIssue=publicGatewayRuntimeBootstrapIssue(env);
  const issue=bootstrapIssue??"public_provider_live_qualification_required";
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
