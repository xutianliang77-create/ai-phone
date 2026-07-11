import type { SessionEndReason, UsageTickEvent } from "@translation/contracts";
import type { RealtimeSession } from "../sessions/realtime-session.js";

export const USAGE_TICK_SECONDS = 30;
export const LOW_BALANCE_WARNING_SECONDS = 30;

export interface UsageBalanceSnapshot {
  remainingSeconds: number;
  availableSeconds?: number;
}

export interface UsageTickDecision {
  event: UsageTickEvent;
  shouldEnd: boolean;
  endReason?: SessionEndReason;
}

export function createUsageTick(
  session: RealtimeSession,
  balance?: UsageBalanceSnapshot | null,
): UsageTickEvent {
  return createUsageTickDecision(session, balance).event;
}

export function createUsageTickDecision(
  session: RealtimeSession,
  balance?: UsageBalanceSnapshot | null,
): UsageTickDecision {
  const nextBillableSeconds = session.billableSeconds + USAGE_TICK_SECONDS;
  const balanceSeconds = effectiveBalanceSeconds(session, balance);
  const billableSeconds =
    balanceSeconds === null
      ? nextBillableSeconds
      : Math.min(nextBillableSeconds, balanceSeconds);
  session.billableSeconds = billableSeconds;

  const remainingByDuration = Math.max(
    0,
    session.claims.maxDurationSeconds - billableSeconds,
  );
  const remainingByBalance =
    balanceSeconds === null ? remainingByDuration : Math.max(0, balanceSeconds - billableSeconds);
  const remainingSeconds = Math.min(remainingByDuration, remainingByBalance);
  const quotaExhausted = balanceSeconds !== null && remainingByBalance <= 0;
  const timeLimitReached = remainingByDuration <= 0;

  return {
    event: {
      type: "usage.tick",
      sessionId: session.id,
      billableSeconds,
      remainingSeconds,
      ...(remainingSeconds > 0 && remainingSeconds <= LOW_BALANCE_WARNING_SECONDS
        ? { lowBalance: true }
        : {}),
    },
    shouldEnd: quotaExhausted || timeLimitReached,
    ...(quotaExhausted
      ? { endReason: "quota_exhausted" as const }
      : timeLimitReached
        ? { endReason: "time_limit" as const }
        : {}),
  };
}

function normalizeBalanceSeconds(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function effectiveBalanceSeconds(
  session: RealtimeSession,
  balance?: UsageBalanceSnapshot | null,
) {
  const availableSeconds = normalizeBalanceSeconds(balance?.availableSeconds);
  if (availableSeconds !== null) {
    return availableSeconds +
      (normalizeBalanceSeconds(session.claims.holdSeconds) ?? 0);
  }
  return normalizeBalanceSeconds(balance?.remainingSeconds);
}
