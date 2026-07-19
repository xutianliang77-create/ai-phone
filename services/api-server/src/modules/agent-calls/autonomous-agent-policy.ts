import type { AgentCallRecord } from "./agent-call-record.js";

export function evaluateAutonomousAgentPolicy(input: {
  userId: string;
  draft: AgentCallRecord;
}) {
  if (process.env.VOICE_AGENT_ENABLED !== "true") {
    return denied("voice_agent_disabled");
  }
  if (process.env.VOICE_AGENT_AUTONOMOUS_ENABLED !== "true") {
    return denied("autonomous_disabled");
  }
  if (!csv(process.env.VOICE_AGENT_AUTONOMOUS_USER_IDS).includes(input.userId)) {
    return denied("autonomous_not_allowlisted");
  }
  const scenarios = csv(process.env.VOICE_AGENT_AUTONOMOUS_SCENARIOS);
  if (!scenarios.includes(input.draft.scenario)) {
    return denied("autonomous_scenario_not_allowed");
  }
  if (input.draft.riskLevel !== "low" || input.draft.riskReasons.length > 0) {
    return denied("autonomous_risk_denied");
  }
  if (!input.draft.recipientDisclosureConfirmed ||
    !input.draft.disclosurePromptVersion) {
    return denied("autonomous_disclosure_required");
  }
  const policyVersion = process.env.VOICE_AGENT_POLICY_VERSION?.trim();
  if (!policyVersion) return denied("autonomous_policy_missing");
  return { allowed: true as const, policyVersion };
}

export function autonomousAgentPolicyRequired() {
  return process.env.VOICE_AGENT_ENABLED === "true" ||
    process.env.VOICE_AGENT_AUTONOMOUS_ENABLED === "true";
}

export function getAutonomousAgentReadiness() {
  const enabled = process.env.VOICE_AGENT_ENABLED === "true" &&
    process.env.VOICE_AGENT_AUTONOMOUS_ENABLED === "true";
  const issues = [
    ...(enabled ? [] : ["Autonomous Agent is disabled"]),
    ...(csv(process.env.VOICE_AGENT_AUTONOMOUS_USER_IDS).length > 0
      ? []
      : ["Autonomous Agent allowlist is empty"]),
    ...(csv(process.env.VOICE_AGENT_AUTONOMOUS_SCENARIOS).length > 0
      ? []
      : ["Autonomous Agent scenario allowlist is empty"]),
    ...(process.env.VOICE_AGENT_POLICY_VERSION?.trim()
      ? []
      : ["VOICE_AGENT_POLICY_VERSION is required"]),
  ];
  return { status: enabled && issues.length === 0 ? "ready" : "not_ready", issues };
}

function denied(code: string) {
  return {
    allowed: false as const,
    code,
    message: "Autonomous Agent policy denied",
    statusCode: 403,
  };
}

function csv(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}
