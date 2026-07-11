import { getPstnReadiness } from "../calls/pstn-readiness.js";

export function getAgentCallExecutionReadiness() {
  const pstnReadiness = getPstnReadiness();
  const issues = [
    ...agentWorkerIssues(),
    ...pstnExecutionIssues(pstnReadiness),
    ...internalSecretIssues(),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    agentWorker:
      process.env.AGENT_CALL_WORKER_ENABLED === "true" ? "enabled" : "disabled",
    pstnReadiness,
    issues,
  };
}

function agentWorkerIssues() {
  return process.env.AGENT_CALL_WORKER_ENABLED === "true"
    ? []
    : ["agent call worker disabled"];
}

function pstnExecutionIssues(
  pstnReadiness: ReturnType<typeof getPstnReadiness>,
) {
  if (!pstnReadiness.enabled) {
    return ["agent call execution requires domestic_pstn_bridge policy"];
  }
  return pstnReadiness.issues;
}

function internalSecretIssues() {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  return secret && secret.length >= 16
    ? []
    : ["agent call worker requires INTERNAL_API_SECRET"];
}
