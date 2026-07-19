import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type {
  PostgresAggregateFence,
  PostgresPrimaryTransaction,
  PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type {
  ImmutableBillingLedgerEntry,
  PostgresUsageAccountRecord,
  PostgresUsageBalance,
  PostgresUsagePlan,
  VersionedUsageHoldRecord,
} from "./postgres-usage-records.js";

const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export function usageCommand(input: {
  aggregateType: "communication_session" | "billing_account";
  aggregateId: string;
  commandId: string;
  commandType: string;
  requestHash: string;
}): PrimaryCommandIdentity {
  if (!bounded(input.aggregateId, 160) || !bounded(input.commandId, 200) ||
    !bounded(input.commandType, 100) || !bounded(input.requestHash, 128) ||
    input.requestHash.trim().length < 16) {
    throw new Error("Invalid PostgreSQL usage command identity");
  }
  return input;
}

export function assertUsageFence(input: {
  fence: PostgresAggregateFence;
  userId: string;
  sessionId?: string;
}) {
  const expectedType = input.sessionId ? "communication_session" : "billing_account";
  const expectedId = input.sessionId ?? input.userId;
  if (input.fence.aggregateType !== expectedType ||
    input.fence.aggregateId !== expectedId) {
    throw new Error("Usage mutation has the wrong aggregate fence");
  }
}

export async function lockUsageAccount(
  transaction: PostgresPrimaryTransaction,
  input: {
    userId: string;
    plan: PostgresUsagePlan;
    now: string;
    commandId: string;
    sessionId?: string;
  },
) {
  validatePlan(input.userId, input.plan);
  const rows = await transaction.queryRead<UserRow>(`
    SELECT user_id FROM ai_phone.usage_accounts
    WHERE user_id = $1 FOR UPDATE
  `, [input.userId]);
  const primary = await transaction.read<PostgresUsageAccountRecord>(
    "usageAccounts",
    input.userId,
  );
  if (rows.length > 0 && !primary) {
    throw new Error("Normalized usage account is missing its primary record");
  }
  if (rows.length === 0 && primary) {
    throw new Error("Usage account primary record is missing its projection");
  }
  if (!primary) {
    const account: PostgresUsageAccountRecord = {
      userId: input.userId,
      planCode: input.plan.code,
      monthlySeconds: input.plan.monthlySeconds,
      remainingSeconds: input.plan.monthlySeconds,
      version: 1,
      updatedAt: input.now,
    };
    return storeAccount(transaction, input, account, null, "initialized");
  }
  const current = requireUsageAccount(primary.payload, input.userId);
  if (current.planCode === input.plan.code &&
    current.monthlySeconds === input.plan.monthlySeconds) {
    return { account: current, primary };
  }
  const next: PostgresUsageAccountRecord = {
    ...current,
    planCode: input.plan.code,
    monthlySeconds: input.plan.monthlySeconds,
    remainingSeconds: current.planCode === input.plan.code
      ? current.remainingSeconds
      : input.plan.monthlySeconds,
    version: current.version + 1,
    updatedAt: input.now,
  };
  return storeAccount(
    transaction,
    input,
    next,
    primary.recordVersion,
    "plan_changed",
  );
}

export function updateUsageAccount(
  transaction: PostgresPrimaryTransaction,
  input: {
    account: PostgresUsageAccountRecord;
    expectedRecordVersion: number;
    commandId: string;
    sessionId?: string;
    reason: string;
  },
) {
  requireUsageAccount(input.account, input.account.userId);
  return storeAccount(
    transaction,
    input,
    input.account,
    input.expectedRecordVersion,
    input.reason,
  );
}

async function storeAccount(
  transaction: PostgresPrimaryTransaction,
  input: { commandId: string; sessionId?: string },
  account: PostgresUsageAccountRecord,
  expectedRecordVersion: number | null,
  reason: string,
) {
  const eventId = usageEventId(input.commandId, `account:${reason}`);
  const stored = await transaction.mutate<PostgresUsageAccountRecord>({
    eventId,
    namespace: "usageAccounts",
    recordKey: account.userId,
    operation: "upsert",
    payload: account,
    expectedRecordVersion,
  });
  const saved = requireUsageAccount(stored?.payload, account.userId);
  await enqueueUsageEvent(transaction, {
    eventId,
    sessionId: input.sessionId,
    version: saved.version,
    eventType: `usage_account.${reason}`,
    payload: { account: saved },
  });
  return { account: saved, primary: stored! };
}

export async function activeHeldSeconds(
  transaction: PostgresPrimaryTransaction,
  userId: string,
  now: string,
) {
  const rows = await transaction.queryRead<SumRow>(`
    SELECT COALESCE(sum(seconds), 0)::text AS held_seconds
    FROM ai_phone.usage_holds
    WHERE user_id = $1 AND status = 'active' AND expires_at > $2::timestamptz
  `, [userId, now]);
  const held = Number(rows[0]?.held_seconds ?? 0);
  if (!Number.isSafeInteger(held) || held < 0) {
    throw new Error("Invalid PostgreSQL held usage total");
  }
  return held;
}

export async function findUsageHold(
  transaction: PostgresPrimaryTransaction,
  input: { userId: string; sessionId?: string; idempotencyKey?: string },
) {
  const rows = input.idempotencyKey
    ? await transaction.queryRead<IdRow>(`
      SELECT id FROM ai_phone.usage_holds
      WHERE user_id = $1 AND idempotency_key = $2
    `, [input.userId, input.idempotencyKey])
    : input.sessionId
    ? await transaction.queryRead<IdRow>(`
      SELECT id FROM ai_phone.usage_holds
      WHERE user_id = $1 AND session_id = $2 AND status = 'active'
    `, [input.userId, input.sessionId])
    : [];
  if (!rows[0]) return null;
  const record = await transaction.read<VersionedUsageHoldRecord>(
    "usageHolds",
    rows[0].id,
  );
  if (!record) throw new Error("Normalized usage hold is missing its primary record");
  return { hold: requireUsageHold(record.payload, rows[0].id), primary: record };
}

export async function findLedgerEntry(
  transaction: PostgresPrimaryTransaction,
  userId: string,
  idempotencyKey: string,
) {
  const rows = await transaction.queryRead<IdRow>(`
    SELECT id FROM ai_phone.billing_ledger_entries
    WHERE user_id = $1 AND idempotency_key = $2
  `, [userId, idempotencyKey]);
  if (!rows[0]) return null;
  const record = await transaction.read<ImmutableBillingLedgerEntry>(
    "billingLedger",
    rows[0].id,
  );
  if (!record) throw new Error("Normalized ledger entry is missing its primary record");
  return requireLedgerEntry(record.payload, rows[0].id);
}

export async function recordUsageCommand<T>(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: T,
) {
  const recorded = await transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(Date.now() + commandRetentionMs).toISOString(),
  });
  return recorded.result;
}

export function usageBalance(
  account: PostgresUsageAccountRecord,
  heldSeconds: number,
): PostgresUsageBalance {
  return {
    userId: account.userId,
    planCode: account.planCode,
    monthlySeconds: account.monthlySeconds,
    remainingSeconds: account.remainingSeconds,
    heldSeconds,
    availableSeconds: Math.max(0, account.remainingSeconds - heldSeconds),
  };
}

export async function enqueueUsageEvent(
  transaction: PostgresPrimaryTransaction,
  input: {
    eventId: string;
    sessionId?: string;
    version: number;
    eventType: string;
    payload: unknown;
  },
) {
  await transaction.enqueueOutbox({
    id: input.eventId,
    idempotencyKey: input.eventId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    aggregateVersion: input.version,
    sequence: input.version,
    eventType: input.eventType,
    eventVersion: 1,
    payload: input.payload,
  });
}

export function requireUsageAccount(value: unknown, userId: string) {
  const account = value as Partial<PostgresUsageAccountRecord> | null;
  if (!account || account.userId !== userId || !bounded(account.planCode ?? "", 80) ||
    !nonnegative(account.monthlySeconds) || !integer(account.remainingSeconds) ||
    !positiveVersion(account.version) || !validTimestamp(account.updatedAt)) {
    throw new Error("Invalid PostgreSQL usage account record");
  }
  return account as PostgresUsageAccountRecord;
}

export function requireUsageHold(value: unknown, holdId: string) {
  const hold = value as Partial<VersionedUsageHoldRecord> | null;
  if (!hold || hold.id !== holdId || !bounded(hold.userId ?? "", 160) ||
    !nonnegative(hold.seconds) || hold.seconds === 0 ||
    !bounded(hold.requestHash ?? "", 128) || (hold.requestHash?.length ?? 0) < 16 ||
    !["active", "released", "settled"].includes(hold.status ?? "") ||
    !positiveVersion(hold.version) || !validTimestamp(hold.createdAt) ||
    !validTimestamp(hold.expiresAt)) {
    throw new Error("Invalid PostgreSQL usage hold record");
  }
  return hold as VersionedUsageHoldRecord;
}

export function requireLedgerEntry(value: unknown, ledgerId: string) {
  const entry = value as Partial<ImmutableBillingLedgerEntry> | null;
  if (!entry || entry.id !== ledgerId || !bounded(entry.userId ?? "", 160) ||
    !["purchase", "usage", "refund"].includes(entry.type ?? "") ||
    !bounded(entry.source ?? "", 80) ||
    !integer(entry.deltaSeconds) || !integer(entry.balanceAfter) ||
    !bounded(entry.requestHash ?? "", 128) || (entry.requestHash?.length ?? 0) < 16 ||
    !validTimestamp(entry.createdAt)) {
    throw new Error("Invalid PostgreSQL billing ledger entry");
  }
  return entry as ImmutableBillingLedgerEntry;
}

export function usageEventId(commandId: string, suffix: string) {
  return `event_${createHash("sha256")
    .update(`${commandId}:${suffix}`).digest("hex")}`;
}

export function deterministicRecordId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function validatePlan(userId: string, plan: PostgresUsagePlan) {
  if (!bounded(userId, 160) || !bounded(plan.code, 80) ||
    !nonnegative(plan.monthlySeconds)) {
    throw new Error("Invalid PostgreSQL usage plan");
  }
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function nonnegative(value: unknown): value is number {
  return integer(value) && value >= 0;
}

function positiveVersion(value: unknown): value is number {
  return integer(value) && value > 0;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

interface UserRow extends QueryResultRow { user_id: string }
interface IdRow extends QueryResultRow { id: string }
interface SumRow extends QueryResultRow { held_seconds: string }
