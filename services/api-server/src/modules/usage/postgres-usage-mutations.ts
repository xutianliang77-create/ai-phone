import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import type {
  ImmutableBillingLedgerEntry,
  PostgresUsageAccountRecord,
  VersionedUsageHoldRecord,
} from "./postgres-usage-records.js";
import {
  enqueueUsageEvent,
  requireLedgerEntry,
  requireUsageHold,
  updateUsageAccount,
  usageEventId,
} from "./postgres-usage-uow.js";

export async function saveUsageBalance(
  transaction: PostgresPrimaryTransaction,
  input: {
    current: PostgresUsageAccountRecord;
    currentRecordVersion: number;
    remainingSeconds: number;
    commandId: string;
    sessionId?: string;
    reason: string;
    now: string;
  },
) {
  if (!Number.isSafeInteger(input.remainingSeconds)) {
    throw new Error("Invalid PostgreSQL usage balance mutation");
  }
  return updateUsageAccount(transaction, {
    account: {
      ...input.current,
      remainingSeconds: input.remainingSeconds,
      version: input.current.version + 1,
      updatedAt: input.now,
    },
    expectedRecordVersion: input.currentRecordVersion,
    commandId: input.commandId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    reason: input.reason,
  });
}

export async function transitionUsageHold(
  transaction: PostgresPrimaryTransaction,
  input: {
    hold: VersionedUsageHoldRecord;
    currentRecordVersion: number;
    status: "released" | "settled";
    commandId: string;
    sessionId: string;
    now: string;
    settledSeconds?: number;
  },
) {
  if (input.hold.status !== "active") return input.hold;
  const next: VersionedUsageHoldRecord = {
    ...input.hold,
    status: input.status,
    version: input.hold.version + 1,
    releasedAt: input.now,
    ...(input.status === "settled" ? {
      settledAt: input.now,
      settledSeconds: normalizeSeconds(input.settledSeconds ?? 0),
    } : {}),
  };
  const eventId = usageEventId(input.commandId, `hold:${input.status}`);
  const stored = await transaction.mutate<VersionedUsageHoldRecord>({
    eventId,
    namespace: "usageHolds",
    recordKey: next.id,
    operation: "upsert",
    payload: next,
    expectedRecordVersion: input.currentRecordVersion,
  });
  const saved = requireUsageHold(stored?.payload, next.id);
  await enqueueUsageEvent(transaction, {
    eventId,
    sessionId: input.sessionId,
    version: saved.version,
    eventType: `usage_hold.${input.status}`,
    payload: { hold: saved },
  });
  return saved;
}

export async function appendUsageLedger(
  transaction: PostgresPrimaryTransaction,
  input: {
    entry: ImmutableBillingLedgerEntry;
    commandId: string;
    aggregateVersion: number;
  },
) {
  const eventId = usageEventId(input.commandId, `ledger:${input.entry.id}`);
  const stored = await transaction.mutate<ImmutableBillingLedgerEntry>({
    eventId,
    namespace: "billingLedger",
    recordKey: input.entry.id,
    operation: "upsert",
    payload: input.entry,
    expectedRecordVersion: null,
  });
  const saved = requireLedgerEntry(stored?.payload, input.entry.id);
  await enqueueUsageEvent(transaction, {
    eventId,
    ...(saved.sessionId ? { sessionId: saved.sessionId } : {}),
    version: input.aggregateVersion,
    eventType: `billing_ledger.${saved.type}`,
    payload: { ledger: saved },
  });
  return saved;
}

function normalizeSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}
