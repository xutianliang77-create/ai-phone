import { refundUsage } from "../usage/usage-hold-runtime.service.js";
import type { SessionRecord } from "./session-record.js";

export interface SessionUsageRefundOptions {
  reason?: unknown;
}

export async function refundSessionUsage(
  session: SessionRecord,
  options: SessionUsageRefundOptions = {},
) {
  const refundedSeconds = normalizeSeconds(session.consumedSeconds);
  const reason = cleanReason(options.reason);
  const idempotencyKey = `refund:${session.id}`;
  const result = await refundUsage(
    session.userId,
    session.id,
    refundedSeconds,
    `usage_refund:${reason}`,
  );
  const ledger = "ledger" in result ? result.ledger : undefined;
  return {
    idempotencyKey,
    reason,
    refundedSeconds: "refundedSeconds" in result
      ? result.refundedSeconds : Math.max(0, result.ledger.deltaSeconds),
    balance: result.balance,
    ledger,
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
