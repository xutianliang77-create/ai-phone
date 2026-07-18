import { getPstnReadiness } from "../calls/pstn-readiness.js";
import {
  autonomousAgentPolicyRequired,
  getAutonomousAgentReadiness,
} from "./autonomous-agent-policy.js";

export function getAgentCallExecutionReadiness() {
  const pstnReadiness = getPstnReadiness();
  const autonomousReadiness = getAutonomousAgentReadiness();
  const issues = [
    ...agentWorkerIssues(),
    ...agentProviderIssues(),
    ...agentLeaseIssues(),
    ...pstnExecutionIssues(pstnReadiness),
    ...internalSecretIssues(),
    ...(autonomousAgentPolicyRequired() ? autonomousReadiness.issues : []),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    agentWorker:
      process.env.AGENT_CALL_WORKER_ENABLED === "true" ? "enabled" : "disabled",
    pstnReadiness,
    grayMode: process.env.AGENT_CALL_GRAY_ENABLED === "true" ? "allowlist" : "open",
    autonomousReadiness,
    issues,
  };
}

function agentWorkerIssues() {
  return process.env.AGENT_CALL_WORKER_ENABLED === "true"
    ? []
    : ["agent call worker disabled"];
}

function agentProviderIssues() {
  const provider = process.env.AGENT_CALL_PROVIDER_ADAPTER;
  const valid = provider === "livekit_sip" || provider === "pstn_http" ||
    provider === "pstn_fonoster";
  return [
    ...(valid ? [] : ["agent call provider adapter is not configured"]),
    ...(process.env.PSTN_PROVIDER_IDEMPOTENCY_GUARANTEED === "true"
      ? []
      : ["agent call provider must guarantee dial idempotency"]),
  ];
}

function agentLeaseIssues() {
  const seconds = Number(process.env.AGENT_CALL_WORKER_LEASE_SECONDS ?? 45);
  const reconciliation = Number(
    process.env.AGENT_CALL_RECONCILIATION_TIMEOUT_SECONDS ?? 7200,
  );
  return [
    ...(Number.isInteger(seconds) && seconds >= 15 && seconds <= 300
      ? []
      : ["agent call worker lease must be 15-300 seconds"]),
    ...(Number.isInteger(reconciliation) && reconciliation >= 300 &&
        reconciliation <= 86_400
      ? []
      : ["agent call reconciliation timeout must be 300-86400 seconds"]),
  ];
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
