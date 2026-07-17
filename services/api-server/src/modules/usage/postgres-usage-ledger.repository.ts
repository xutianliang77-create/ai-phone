import type { Pool } from "pg";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type { BillingLedgerEntry } from "../billing/billing-records.js";
import type {
  ImmutableBillingLedgerEntry,
  PostgresUsageBalance,
  PostgresUsagePlan,
  VersionedUsageHoldRecord,
} from "./postgres-usage-records.js";
import {
  appendUsageLedger,
  saveUsageBalance,
  transitionUsageHold,
} from "./postgres-usage-mutations.js";
import {
  activeHeldSeconds,
  assertUsageFence,
  deterministicRecordId,
  findLedgerEntry,
  findUsageHold,
  lockUsageAccount,
  recordUsageCommand,
  usageBalance,
  usageCommand,
} from "./postgres-usage-uow.js";

interface LedgerMutationInput {
  userId: string;
  plan: PostgresUsagePlan;
  commandId: string;
  commandType: string;
  requestHash: string;
  idempotencyKey: string;
  type: BillingLedgerEntry["type"];
  source: BillingLedgerEntry["source"];
  deltaSeconds: number;
  fence: PostgresAggregateFence;
  sessionId?: string;
  orderId?: string;
  productId?: string;
  note?: string;
  holdAction?: "released" | "settled";
  settledSeconds?: number;
  now?: Date;
}

export type PostgresLedgerMutationResult = {
  status: "applied";
  replayed: boolean;
  appliedDeltaSeconds: number;
  balance: PostgresUsageBalance;
  ledger: ImmutableBillingLedgerEntry;
  hold?: VersionedUsageHoldRecord;
} | {
  status: "idempotency_conflict";
  balance: PostgresUsageBalance;
  ledger: ImmutableBillingLedgerEntry;
};

export class PostgresUsageLedgerRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  settleSession(input: Omit<LedgerMutationInput,
    "type" | "source" | "deltaSeconds" | "holdAction" | "settledSeconds"> & {
      seconds: number;
      sessionId: string;
    }) {
    const seconds = normalizeSeconds(input.seconds);
    return this.apply({
      ...input,
      type: "usage",
      source: "system",
      deltaSeconds: -seconds,
      holdAction: "settled",
      settledSeconds: seconds,
    });
  }

  refundSession(input: Omit<LedgerMutationInput,
    "type" | "source" | "deltaSeconds" | "holdAction"> & {
      seconds: number;
      sessionId: string;
    }) {
    return this.apply({
      ...input,
      type: "refund",
      source: "system",
      deltaSeconds: normalizeSeconds(input.seconds),
      holdAction: "released",
    });
  }

  adjustAccount(input: Omit<LedgerMutationInput, "sessionId" | "holdAction">) {
    return this.apply(input);
  }

  private async apply(input: LedgerMutationInput) {
    validateMutation(input);
    assertUsageFence(input);
    const aggregateType = input.sessionId
      ? "communication_session" as const
      : "billing_account" as const;
    const aggregateId = input.sessionId ?? input.userId;
    const command = usageCommand({
      aggregateType,
      aggregateId,
      commandId: input.commandId,
      commandType: input.commandType,
      requestHash: input.requestHash,
    });
    const execute = () => this.primary
      .withAggregateTransaction<PostgresLedgerMutationResult>(
        input.fence,
        async (transaction) => {
          const replay = await transaction
            .readCommandResult<PostgresLedgerMutationResult>(command);
          if (replay) return replay;
          const now = (input.now ?? new Date()).toISOString();
          const locked = await lockUsageAccount(transaction, {
            userId: input.userId,
            plan: input.plan,
            now,
            commandId: input.commandId,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          });
          const existingLedger = await findLedgerEntry(
            transaction,
            input.userId,
            input.idempotencyKey,
          );
          if (existingLedger) {
            const held = await activeHeldSeconds(transaction, input.userId, now);
            const balance = usageBalance(locked.account, held);
            if (existingLedger.requestHash !== input.requestHash) {
              return recordUsageCommand(transaction, command, {
                status: "idempotency_conflict",
                balance,
                ledger: existingLedger,
              });
            }
            const hold = await this.finishHold(transaction, input, now);
            const currentHeld = await activeHeldSeconds(transaction, input.userId, now);
            return recordUsageCommand(transaction, command, {
              status: "applied",
              replayed: true,
              appliedDeltaSeconds: existingLedger.deltaSeconds,
              balance: usageBalance(locked.account, currentHeld),
              ledger: existingLedger,
              ...(hold ? { hold } : {}),
            });
          }

          const nextRemaining = input.type === "usage"
            ? Math.max(0, locked.account.remainingSeconds + input.deltaSeconds)
            : locked.account.remainingSeconds + input.deltaSeconds;
          const appliedDeltaSeconds = nextRemaining - locked.account.remainingSeconds;
          const accountState = appliedDeltaSeconds === 0
            ? locked
            : await saveUsageBalance(transaction, {
              current: locked.account,
              currentRecordVersion: locked.primary.recordVersion,
              remainingSeconds: nextRemaining,
              commandId: input.commandId,
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              reason: input.type,
              now,
            });
          const ledger: ImmutableBillingLedgerEntry = {
            id: deterministicRecordId(
              "ledger",
              `${input.userId}:${input.idempotencyKey}`,
            ),
            userId: input.userId,
            type: input.type,
            source: input.source,
            deltaSeconds: appliedDeltaSeconds,
            balanceAfter: accountState.account.remainingSeconds,
            createdAt: now,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.orderId ? { orderId: input.orderId } : {}),
            ...(input.productId ? { productId: input.productId } : {}),
            ...(input.note ? { note: input.note.slice(0, 240) } : {}),
          };
          const savedLedger = await appendUsageLedger(transaction, {
            entry: ledger,
            commandId: input.commandId,
            aggregateVersion: accountState.account.version,
          });
          const hold = await this.finishHold(transaction, input, now);
          const held = await activeHeldSeconds(transaction, input.userId, now);
          return recordUsageCommand(transaction, command, {
            status: "applied",
            replayed: false,
            appliedDeltaSeconds,
            balance: usageBalance(accountState.account, held),
            ledger: savedLedger,
            ...(hold ? { hold } : {}),
          });
        },
      );
    try {
      return await execute();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return execute();
    }
  }

  private async finishHold(
    transaction: Parameters<typeof findUsageHold>[0],
    input: LedgerMutationInput,
    now: string,
  ) {
    if (!input.sessionId || !input.holdAction) return null;
    const current = await findUsageHold(transaction, {
      userId: input.userId,
      sessionId: input.sessionId,
    });
    if (!current) return null;
    return transitionUsageHold(transaction, {
      hold: current.hold,
      currentRecordVersion: current.primary.recordVersion,
      status: input.holdAction,
      commandId: input.commandId,
      sessionId: input.sessionId,
      now,
      ...(input.settledSeconds !== undefined
        ? { settledSeconds: input.settledSeconds }
        : {}),
    });
  }
}

function validateMutation(input: LedgerMutationInput) {
  if (!bounded(input.userId, 160) || !bounded(input.idempotencyKey, 200) ||
    !Number.isSafeInteger(input.deltaSeconds) ||
    (input.type === "usage" && (!input.sessionId || input.deltaSeconds > 0)) ||
    (input.holdAction && !input.sessionId)) {
    throw new Error("Invalid PostgreSQL ledger mutation");
  }
}

function normalizeSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}
