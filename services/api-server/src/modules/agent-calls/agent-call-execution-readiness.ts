import { getPstnReadiness } from "../calls/pstn-readiness.js";
import {
  autonomousAgentPolicyRequired,
  getAutonomousAgentReadiness,
} from "./autonomous-agent-policy.js";
import {
  configuredAgentCallProvider,
  isAgentCallProvider,
} from "./agent-call-provider-profile.js";
import { getAirDeviceGatewayConfig } from
  "../device-calls/air-device-gateway-readiness.js";

export function getAgentCallExecutionReadiness() {
  const pstnReadiness = getPstnReadiness();
  const autonomousReadiness = getAutonomousAgentReadiness();
  const provider = configuredAgentCallProvider();
  const issues = [
    ...agentWorkerIssues(),
    ...agentProviderIssues(),
    ...airProviderIssues(provider),
    ...agentLeaseIssues(),
    ...telephonyExecutionIssues(provider, pstnReadiness),
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

function airProviderIssues(
  provider: ReturnType<typeof configuredAgentCallProvider>,
) {
  if (provider !== "air780_volte") return [];
  const gateway = getAirDeviceGatewayConfig();
  return [
    ...(process.env.API_STORAGE_DRIVER === "postgres"
      ? []
      : ["Air780 agent calls require API_STORAGE_DRIVER=postgres"]),
    ...(gateway.ok ? [] : gateway.issues),
  ];
}

function agentWorkerIssues() {
  return process.env.AGENT_CALL_WORKER_ENABLED === "true"
    ? []
    : ["agent call worker disabled"];
}

function agentProviderIssues() {
  const provider = process.env.AGENT_CALL_PROVIDER_ADAPTER;
  const valid = isAgentCallProvider(provider);
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

function telephonyExecutionIssues(
  provider: ReturnType<typeof configuredAgentCallProvider>,
  pstnReadiness: ReturnType<typeof getPstnReadiness>,
) {
  if (provider === "air780_volte") return [];
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
