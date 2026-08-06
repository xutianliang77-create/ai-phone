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
  const target = evaluateAgentCallTargetPolicy(input.targetPhone);
  if (!target.allowed) return target;
  // A value of 0 explicitly disables the product-level hourly gate.  Keep the
  // default conservative for environments that do not opt out deliberately.
  const now = input.now ?? new Date();
  const limit = nonNegativeInteger(process.env.AGENT_CALL_RATE_LIMIT_PER_HOUR, 3);
  if (limit === 0) return { allowed: true as const, rateLimitPerHour: 0 };
  const since = now.getTime() - 60 * 60 * 1000;
  const recentStarts = input.drafts.filter((draft) =>
    draft.userId === input.userId &&
    draft.queuedAt != null &&
    Date.parse(draft.queuedAt) >= since
  ).length;
  if (recentStarts >= limit) {
    const oldest = input.drafts
      .filter((draft) => draft.userId === input.userId && draft.queuedAt != null)
      .map((draft) => Date.parse(draft.queuedAt!))
      .filter((queuedAt) => Number.isFinite(queuedAt) && queuedAt >= since)
      .sort((a, b) => a - b)[0];
    const nextAllowedAt = Number.isFinite(oldest)
      ? new Date(oldest + 60 * 60 * 1000)
      : new Date(now.getTime() + 60 * 60 * 1000);
    return denied("rate_limited", "AI calling hourly rate limit exceeded", 429, {
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((nextAllowedAt.getTime() - now.getTime()) / 1000),
      ),
      nextAllowedAt: nextAllowedAt.toISOString(),
    });
  }
  return { allowed: true as const, rateLimitPerHour: limit };
}

export function evaluateAgentCallTargetPolicy(targetPhone: string) {
  const phone = normalizeAgentCallPhone(targetPhone);
  if (!isValidAgentCallPhone(phone)) {
    return denied("invalid_target", "Target phone number is invalid");
  }
  if (blockedNumbers().has(phone) || emergencyNumbers.has(phone)) {
    return denied("do_not_call", "Target number is blocked from AI calling");
  }
  return { allowed: true as const };
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
  return new Set(csv(process.env.AGENT_CALL_DO_NOT_CALL_NUMBERS).map(normalizeAgentCallPhone));
}

export function normalizeAgentCallPhone(value: string) {
  return value.trim().replace(/[^\d+]/g, "").replace(/^\+86/, "");
}

export function toAgentCallE164Phone(value: string) {
  const phone = normalizeAgentCallPhone(value);
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  if (/^1[3-9]\d{9}$/.test(phone)) return `+86${phone}`;
  if (/^0\d{9,11}$/.test(phone)) return `+86${phone.slice(1)}`;
  return null;
}

export function isValidAgentCallPhone(value: string) {
  const phone = normalizeAgentCallPhone(value);
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return true;
  if (/^1[3-9]\d{9}$/.test(phone)) return true;
  if (/^0\d{9,11}$/.test(phone)) return true;
  return /^(?:10|95|96)\d{3,4}$/.test(phone);
}

function csv(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function denied(
  code: string,
  message: string,
  statusCode = 403,
  details: { retryAfterSeconds?: number; nextAllowedAt?: string } = {},
) {
  return { allowed: false as const, code, message, statusCode, ...details };
}
