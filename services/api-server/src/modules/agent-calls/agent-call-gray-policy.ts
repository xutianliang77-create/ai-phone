import type { AgentCallRecord } from "./agent-call-record.js";

const emergencyNumbers = new Set(["110", "119", "120", "122"]);

export function evaluateAgentCallStartPolicy(input: {
  userId: string;
  targetPhone: string;
  drafts: AgentCallRecord[];
  now?: Date;
}) {
  if (!isGrayUserAllowed(input.userId)) {
    return denied("gray_not_allowed", "Account is not in the AI calling gray allowlist");
  }
  const phone = normalizePhone(input.targetPhone);
  if (!phone || blockedNumbers().has(phone) || emergencyNumbers.has(phone)) {
    return denied("do_not_call", "Target number is blocked from AI calling");
  }
  const limit = positiveInteger(process.env.AGENT_CALL_RATE_LIMIT_PER_HOUR, 3);
  const since = (input.now ?? new Date()).getTime() - 60 * 60 * 1000;
  const recentStarts = input.drafts.filter((draft) =>
    draft.userId === input.userId &&
    draft.queuedAt != null &&
    Date.parse(draft.queuedAt) >= since
  ).length;
  if (recentStarts >= limit) {
    return denied("rate_limited", "AI calling hourly rate limit exceeded", 429);
  }
  return { allowed: true as const, rateLimitPerHour: limit };
}

export function grayModeStatus(userId: string) {
  const enabled = process.env.AGENT_CALL_GRAY_ENABLED === "true";
  return {
    mode: enabled ? "allowlist" : "open",
    allowed: isGrayUserAllowed(userId),
  };
}

function isGrayUserAllowed(userId: string) {
  if (process.env.AGENT_CALL_GRAY_ENABLED !== "true") return true;
  return csv(process.env.AGENT_CALL_GRAY_USER_IDS).includes(userId);
}

function blockedNumbers() {
  return new Set(csv(process.env.AGENT_CALL_DO_NOT_CALL_NUMBERS).map(normalizePhone));
}

function normalizePhone(value: string) {
  return value.trim().replace(/[^\d+]/g, "").replace(/^\+86/, "");
}

function csv(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function denied(code: string, message: string, statusCode = 403) {
  return { allowed: false as const, code, message, statusCode };
}
