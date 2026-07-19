import { consumeSeconds, settleUsageHold } from "../usage/usage.service.js";
import { findBillingLedgerEntryByIdempotencyKey } from "../billing/billing-ledger.service.js";
import type { SessionRecord } from "./session-record.js";

export const MIN_BILLABLE_SESSION_SECONDS = 6;

export interface SessionUsageSettlement {
  rawDurationSeconds: number;
  billableSeconds: number;
  charged: boolean;
  note: string;
  idempotencyKey: string;
}

export interface SessionUsageSettlementOptions {
  billableSeconds?: number;
}

export function settleSessionUsage(
  session: SessionRecord,
  options: SessionUsageSettlementOptions = {},
  nowMs: () => number = Date.now,
): SessionUsageSettlement {
  const rawDurationSeconds = estimateSessionDurationSeconds(
    session.createdAt,
    session.endedAt,
    nowMs,
  );
  const billableSeconds = options.billableSeconds === undefined
    ? toBillableSeconds(rawDurationSeconds)
    : normalizeMeasuredBillableSeconds(options.billableSeconds);
  const note = usageNoteForMode(session.mode);
  const idempotencyKey = `settle:${session.id}`;
  const existing = findBillingLedgerEntryByIdempotencyKey(
    session.userId,
    idempotencyKey,
  );
  if (existing) {
    const settledSeconds = Math.max(0, -existing.deltaSeconds);
    settleUsageHold(session.userId, session.id, settledSeconds);
    return {
      rawDurationSeconds,
      billableSeconds: settledSeconds,
      charged: false,
      note,
      idempotencyKey,
    };
  }

  if (billableSeconds > 0) {
    consumeSeconds(session.userId, billableSeconds, undefined, {
      note,
      sessionId: session.id,
      idempotencyKey,
    });
  }
  settleUsageHold(session.userId, session.id, billableSeconds);

  return {
    rawDurationSeconds,
    billableSeconds,
    charged: billableSeconds > 0,
    note,
    idempotencyKey,
  };
}

export function estimateSessionDurationSeconds(
  createdAt: string,
  endedAt?: string,
  nowMs: () => number = Date.now,
) {
  const endMs = endedAt ? Date.parse(endedAt) : nowMs();
  const startMs = Date.parse(createdAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.ceil((endMs - startMs) / 1000));
}

export function toBillableSeconds(rawDurationSeconds: number) {
  if (!Number.isFinite(rawDurationSeconds)) return 0;
  if (rawDurationSeconds < MIN_BILLABLE_SESSION_SECONDS) return 0;
  return Math.max(0, Math.ceil(rawDurationSeconds));
}

export function normalizeMeasuredBillableSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function usageNoteForMode(mode: SessionRecord["mode"]) {
  if (mode === "call_link") return "call_link_usage";
  return "realtime_session_usage";
}
