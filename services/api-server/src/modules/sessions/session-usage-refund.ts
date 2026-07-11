import { refundSeconds, releaseUsageHold } from "../usage/usage.service.js";
import type { SessionRecord } from "./session-record.js";

export interface SessionUsageRefundOptions {
  reason?: unknown;
}

export function refundSessionUsage(
  session: SessionRecord,
  options: SessionUsageRefundOptions = {},
) {
  const refundedSeconds = normalizeSeconds(session.consumedSeconds);
  const reason = cleanReason(options.reason);
  const idempotencyKey = `refund:${session.id}`;
  const result = refundSeconds(session.userId, refundedSeconds, undefined, {
    sessionId: session.id,
    idempotencyKey,
    note: `usage_refund:${reason}`,
  });
  releaseUsageHold(session.userId, session.id);
  return {
    idempotencyKey,
    reason,
    refundedSeconds: result.refundedSeconds,
    balance: result.balance,
    ledger: result.status === "refunded" ? result.ledger : undefined,
  };
}

function cleanReason(value: unknown) {
  if (typeof value !== "string") return "service_error";
  const trimmed = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return trimmed.slice(0, 80) || "service_error";
}

function normalizeSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}
