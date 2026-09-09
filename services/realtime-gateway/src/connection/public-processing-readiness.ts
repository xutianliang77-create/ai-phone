import type { GatewayDependencyReadiness } from "./gateway-dependency-readiness.js";

/** Implementation gate, NOT a remote health probe or provider qualification.
 * No approved public component adapter/runtime lease issuer is wired yet.
 * The old private URLs and an empty probe list cannot qualify the public chain.
 */
export function publicProcessingReadiness(now = new Date()): GatewayDependencyReadiness {
  return {
    status: "not_ready", sessionReady: false, releaseReady: false,
    checkedAt: now.toISOString(), evidence: "implementation_gate",
    issues: ["public_processing_not_ready", "public_runtime_admission_not_wired"],
    warnings: [],
    services: (["asr", "translation", "tts"] as const).map(name => ({
      name, requiredForSession: true, requiredForRelease: true,
      status: "not_ready", url: "", execution: "public",
      issue: "public_component_adapter_not_wired",
    })),
  };
}
