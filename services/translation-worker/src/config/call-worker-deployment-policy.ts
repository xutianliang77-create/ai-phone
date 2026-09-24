/** The inherited Worker uses global 1.0 ASR/MT/TTS credentials. A public
 * deployment cannot run it unless it is the explicitly isolated 1.0 Call
 * Link compatibility lane. Idle process readiness is checked elsewhere. */
export function assertLegacyCallWorkerDeployment(env: NodeJS.ProcessEnv = process.env) {
  const deploymentId = env.API_RESULT_SYNC_DEPLOYMENT_ID?.trim();
  const publicMode = !!deploymentId || env.PUBLIC_RUNTIME_ENABLED === "true" ||
    env.CALL_LINK_1_0_COMPATIBILITY_ENABLED === "true";
  if (!publicMode) return;
  if (deploymentId && /^[A-Za-z0-9_-]{1,128}$/.test(deploymentId) &&
    env.CALL_LINK_DEPLOYMENT_TEST_MODE !== "true" &&
    env.CALL_LINK_1_0_COMPATIBILITY_ENABLED === "true" &&
    env.CALL_LINK_1_0_COMPATIBILITY_DEPLOYMENT_ID === deploymentId &&
    env.CALL_LINK_1_0_COMPATIBILITY_PROFILE === "call_link_only" &&
    env.CALL_PROVIDER_POLICY === "call_link_only") return;
  throw new Error("call_link_public_model_runtime_unavailable");
}
