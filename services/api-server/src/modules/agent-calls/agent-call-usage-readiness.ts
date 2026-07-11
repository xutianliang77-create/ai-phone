import { getUsageBalance } from "../usage/usage.service.js";

export const AGENT_CALL_MINIMUM_START_SECONDS = 60;

export function getAgentCallUsageReadiness(userId: string) {
  const balance = getUsageBalance(userId);
  const ready = balance.availableSeconds >= AGENT_CALL_MINIMUM_START_SECONDS;
  return {
    status: ready ? "ready" as const : "not_ready" as const,
    minimumStartSeconds: AGENT_CALL_MINIMUM_START_SECONDS,
    remainingSeconds: balance.remainingSeconds,
    heldSeconds: balance.heldSeconds,
    availableSeconds: balance.availableSeconds,
    planCode: balance.planCode,
    issues: ready ? [] : ["agent call requires at least 60 remaining seconds"],
  };
}
