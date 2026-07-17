import type { Pool } from "pg";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type {
  PostgresUsageBalance,
  PostgresUsagePlan,
  VersionedUsageHoldRecord,
} from "./postgres-usage-records.js";
import {
  activeHeldSeconds,
  assertUsageFence,
  deterministicRecordId,
  enqueueUsageEvent,
  findUsageHold,
  lockUsageAccount,
  recordUsageCommand,
  requireUsageHold,
  usageBalance,
  usageCommand,
  usageEventId,
} from "./postgres-usage-uow.js";

interface HoldCommandInput {
  sessionId: string;
  userId: string;
  plan: PostgresUsagePlan;
  commandId: string;
  commandType: string;
  requestHash: string;
  fence: PostgresAggregateFence;
  now?: Date;
}

export type PostgresCreateHoldResult = {
  status: "held";
  replayed: boolean;
  hold: VersionedUsageHoldRecord;
  balance: PostgresUsageBalance;
} | {
  status: "insufficient" | "idempotency_conflict";
  balance: PostgresUsageBalance;
  requiredSeconds?: number;
  hold?: VersionedUsageHoldRecord;
};

export type PostgresReleaseHoldResult = {
  status: "released" | "not_found";
  balance: PostgresUsageBalance;
  hold?: VersionedUsageHoldRecord;
};

export class PostgresUsageHoldsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async create(input: HoldCommandInput & {
    seconds: number;
    idempotencyKey: string;
    note?: string;
    ttlSeconds?: number;
  }) {
    assertUsageFence(input);
    const seconds = normalizedPositiveSeconds(input.seconds);
    const ttlSeconds = input.ttlSeconds ?? 2 * 60 * 60;
    if (!seconds || !bounded(input.idempotencyKey, 200) ||
      !Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 86_400) {
      throw new Error("Invalid PostgreSQL usage hold request");
    }
    const command = usageCommand({
      aggregateType: "communication_session",
      aggregateId: input.sessionId,
      commandId: input.commandId,
      commandType: input.commandType,
      requestHash: input.requestHash,
    });
    const execute = () => this.primary.withAggregateTransaction<PostgresCreateHoldResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<PostgresCreateHoldResult>(command);
        if (replay) return replay;
        const now = (input.now ?? new Date()).toISOString();
        const locked = await lockUsageAccount(transaction, {
          userId: input.userId,
          plan: input.plan,
          now,
          commandId: input.commandId,
          sessionId: input.sessionId,
        });
        const existing = await findUsageHold(transaction, {
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
        });
        const held = await activeHeldSeconds(transaction, input.userId, now);
        const balance = usageBalance(locked.account, held);
        if (existing) {
          const matches = existing.hold.sessionId === input.sessionId &&
            existing.hold.seconds === seconds &&
            existing.hold.requestHash === input.requestHash;
          return recordUsageCommand(transaction, command, matches ? {
            status: "held",
            replayed: true,
            hold: existing.hold,
            balance,
          } : {
            status: "idempotency_conflict",
            balance,
            hold: existing.hold,
          });
        }
        const activeForSession = await findUsageHold(transaction, {
          userId: input.userId,
          sessionId: input.sessionId,
        });
        if (activeForSession && Date.parse(activeForSession.hold.expiresAt) <= Date.parse(now)) {
          const expired: VersionedUsageHoldRecord = {
            ...activeForSession.hold,
            status: "released",
            version: activeForSession.hold.version + 1,
            releasedAt: now,
          };
          const expiredEventId = usageEventId(
            input.commandId,
            `hold:expire:${expired.id}`,
          );
          const stored = await transaction.mutate<VersionedUsageHoldRecord>({
            eventId: expiredEventId,
            namespace: "usageHolds",
            recordKey: expired.id,
            operation: "upsert",
            payload: expired,
            expectedRecordVersion: activeForSession.primary.recordVersion,
          });
          const saved = requireUsageHold(stored?.payload, expired.id);
          await enqueueUsageEvent(transaction, {
            eventId: expiredEventId,
            sessionId: input.sessionId,
            version: saved.version,
            eventType: "usage_hold.expired",
            payload: { hold: saved },
          });
        } else if (activeForSession) {
          return recordUsageCommand(transaction, command, {
            status: "idempotency_conflict",
            balance,
            hold: activeForSession.hold,
          });
        }
        if (balance.availableSeconds < seconds) {
          return recordUsageCommand(transaction, command, {
            status: "insufficient",
            balance,
            requiredSeconds: seconds,
          });
        }
        const hold: VersionedUsageHoldRecord = {
          id: deterministicRecordId(
            "hold",
            `${input.userId}:${input.idempotencyKey}`,
          ),
          userId: input.userId,
          sessionId: input.sessionId,
          seconds,
          status: "active",
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          ...(input.note ? { note: input.note.slice(0, 240) } : {}),
          version: 1,
          createdAt: now,
          expiresAt: new Date(Date.parse(now) + ttlSeconds * 1_000).toISOString(),
        };
        const eventId = usageEventId(input.commandId, "hold:create");
        const stored = await transaction.mutate<VersionedUsageHoldRecord>({
          eventId,
          namespace: "usageHolds",
          recordKey: hold.id,
          operation: "upsert",
          payload: hold,
          expectedRecordVersion: null,
        });
        const saved = requireUsageHold(stored?.payload, hold.id);
        await enqueueUsageEvent(transaction, {
          eventId,
          sessionId: input.sessionId,
          version: saved.version,
          eventType: "usage_hold.created",
          payload: { hold: saved },
        });
        return recordUsageCommand(transaction, command, {
          status: "held",
          replayed: false,
          hold: saved,
          balance: usageBalance(locked.account, held + saved.seconds),
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

  async release(input: HoldCommandInput) {
    assertUsageFence(input);
    const command = usageCommand({
      aggregateType: "communication_session",
      aggregateId: input.sessionId,
      commandId: input.commandId,
      commandType: input.commandType,
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction<PostgresReleaseHoldResult>(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<PostgresReleaseHoldResult>(command);
        if (replay) return replay;
        const now = (input.now ?? new Date()).toISOString();
        const locked = await lockUsageAccount(transaction, {
          userId: input.userId,
          plan: input.plan,
          now,
          commandId: input.commandId,
          sessionId: input.sessionId,
        });
        const existing = await findUsageHold(transaction, {
          userId: input.userId,
          sessionId: input.sessionId,
        });
        if (!existing) {
          const held = await activeHeldSeconds(transaction, input.userId, now);
          return recordUsageCommand(transaction, command, {
            status: "not_found",
            balance: usageBalance(locked.account, held),
          });
        }
        const next: VersionedUsageHoldRecord = {
          ...existing.hold,
          status: "released",
          version: existing.hold.version + 1,
          releasedAt: now,
        };
        const eventId = usageEventId(input.commandId, "hold:release");
        const stored = await transaction.mutate<VersionedUsageHoldRecord>({
          eventId,
          namespace: "usageHolds",
          recordKey: next.id,
          operation: "upsert",
          payload: next,
          expectedRecordVersion: existing.primary.recordVersion,
        });
        const saved = requireUsageHold(stored?.payload, next.id);
        await enqueueUsageEvent(transaction, {
          eventId,
          sessionId: input.sessionId,
          version: saved.version,
          eventType: "usage_hold.released",
          payload: { hold: saved },
        });
        const held = await activeHeldSeconds(transaction, input.userId, now);
        return recordUsageCommand(transaction, command, {
          status: "released",
          balance: usageBalance(locked.account, held),
          hold: saved,
        });
      },
    );
  }
}

function normalizedPositiveSeconds(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.ceil(value));
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}
