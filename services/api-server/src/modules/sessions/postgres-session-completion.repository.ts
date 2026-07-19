import type { Pool } from "pg";
import { participantTrackSpeaker } from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import type {
  ImmutableBillingLedgerEntry,
  PostgresUsageBalance,
  PostgresUsagePlan,
  VersionedUsageHoldRecord,
} from "../usage/postgres-usage-records.js";
import {
  appendUsageLedger,
  saveUsageBalance,
  transitionUsageHold,
} from "../usage/postgres-usage-mutations.js";
import {
  activeHeldSeconds,
  deterministicRecordId,
  findLedgerEntry,
  findUsageHold,
  lockUsageAccount,
  usageBalance,
} from "../usage/postgres-usage-uow.js";
import type { SessionRecord } from "./session-record.js";
import {
  assertSessionFence,
  enqueueSessionChanged,
  recordSessionCommand,
  requireSession,
  requireSessionUpdate,
  sessionCommand,
  sessionEventId,
} from "./postgres-session-uow.js";

export type PostgresSessionCompletionResult = {
  status: "completed";
  session: SessionRecord;
  balance: PostgresUsageBalance;
  ledger: ImmutableBillingLedgerEntry;
  hold?: VersionedUsageHoldRecord;
} | {
  status: "not_found";
} | {
  status: "already_ended" | "version_conflict";
  session: SessionRecord;
} | {
  status: "idempotency_conflict";
  session: SessionRecord;
  ledger: ImmutableBillingLedgerEntry;
};

export class PostgresSessionCompletionRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async complete(input: {
    sessionId: string;
    userId: string;
    nextSession: SessionRecord;
    expectedVersion?: number;
    billableSeconds: number;
    plan: PostgresUsagePlan;
    idempotencyKey: string;
    commandId: string;
    requestHash: string;
    note: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertSessionFence(input.fence, input.sessionId);
    validateInput(input);
    const command = sessionCommand({
      sessionId: input.sessionId,
      commandId: input.commandId,
      commandType: "session.complete_with_usage",
      requestHash: input.requestHash,
    });
    const execute = () => this.primary
      .withAggregateTransaction<PostgresSessionCompletionResult>(
        input.fence,
        async (transaction) => {
          const replay = await transaction
            .readCommandResult<PostgresSessionCompletionResult>(command);
          if (replay) return replay;
          const currentRecord = await transaction.read<SessionRecord>(
            "sessions",
            input.sessionId,
          );
          if (!currentRecord) {
            return recordSessionCommand(transaction, command, {
              status: "not_found",
            });
          }
          const current = requireSession(currentRecord.payload, input.sessionId);
          if (current.userId !== input.userId) {
            throw new Error("Session usage owner does not match the session record");
          }
          if (current.status === "ended") {
            return recordSessionCommand(transaction, command, {
              status: "already_ended",
              session: current,
            });
          }
          if (input.expectedVersion !== undefined &&
            input.expectedVersion !== current.version) {
            return recordSessionCommand(transaction, command, {
              status: "version_conflict",
              session: current,
            });
          }
          const next = requireSessionUpdate(current, input.nextSession);
          const requestedSeconds = normalizeSeconds(input.billableSeconds);
          if (next.status !== "ended" || !next.endedAt ||
            next.consumedSeconds !== requestedSeconds) {
            throw new Error("Session completion must persist an ended session");
          }
          const now = (input.now ?? new Date()).toISOString();
          const accountState = await lockUsageAccount(transaction, {
            userId: input.userId,
            plan: input.plan,
            now,
            commandId: input.commandId,
            sessionId: input.sessionId,
          });
          const existingLedger = await findLedgerEntry(
            transaction,
            input.userId,
            input.idempotencyKey,
          );
          if (existingLedger) {
            return recordSessionCommand(transaction, command, {
              status: "idempotency_conflict",
              session: current,
              ledger: existingLedger,
            });
          }

          const remainingSeconds = Math.max(
            0,
            accountState.account.remainingSeconds - requestedSeconds,
          );
          const appliedDeltaSeconds = remainingSeconds -
            accountState.account.remainingSeconds;
          const savedAccount = appliedDeltaSeconds === 0
            ? accountState
            : await saveUsageBalance(transaction, {
              current: accountState.account,
              currentRecordVersion: accountState.primary.recordVersion,
              remainingSeconds,
              commandId: input.commandId,
              sessionId: input.sessionId,
              reason: "usage",
              now,
            });
          const ledger = await appendUsageLedger(transaction, {
            entry: {
              id: deterministicRecordId(
                "ledger",
                `${input.userId}:${input.idempotencyKey}`,
              ),
              userId: input.userId,
              type: "usage",
              source: "system",
              deltaSeconds: appliedDeltaSeconds,
              balanceAfter: savedAccount.account.remainingSeconds,
              createdAt: now,
              sessionId: input.sessionId,
              idempotencyKey: input.idempotencyKey,
              requestHash: input.requestHash,
              note: input.note.slice(0, 240),
            },
            commandId: input.commandId,
            aggregateVersion: savedAccount.account.version,
          });
          const activeHold = await findUsageHold(transaction, {
            userId: input.userId,
            sessionId: input.sessionId,
          });
          const hold = activeHold
            ? await transitionUsageHold(transaction, {
              hold: activeHold.hold,
              currentRecordVersion: activeHold.primary.recordVersion,
              status: "settled",
              commandId: input.commandId,
              sessionId: input.sessionId,
              now,
              settledSeconds: requestedSeconds,
            })
            : null;
          const sessionEvent = sessionEventId(input.commandId, "complete");
          const storedSession = await transaction.mutate<SessionRecord>({
            eventId: sessionEvent,
            namespace: "sessions",
            recordKey: input.sessionId,
            operation: "upsert",
            payload: next,
            expectedRecordVersion: currentRecord.recordVersion,
          });
          const session = requireSession(storedSession?.payload, input.sessionId);
          await enqueueSessionChanged(transaction, {
            eventId: sessionEvent,
            sessionId: input.sessionId,
            version: session.version,
            eventType: "communication_session.completed",
            session,
          });
          await enqueueCallRoomEnded(transaction, input.commandId, session);
          const held = await activeHeldSeconds(transaction, input.userId, now);
          return recordSessionCommand(transaction, command, {
            status: "completed",
            session,
            balance: usageBalance(savedAccount.account, held),
            ledger,
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
}

async function enqueueCallRoomEnded(
  transaction: Parameters<typeof enqueueSessionChanged>[0],
  commandId: string,
  session: SessionRecord,
) {
  if (session.mode !== "call_link" || !session.callLink) return;
  const eventId = sessionEventId(commandId, "call-room-ended");
  const timestampMs = Date.parse(session.endedAt!);
  await transaction.enqueueOutbox({
    id: eventId,
    idempotencyKey: eventId,
    sessionId: session.id,
    aggregateVersion: session.version,
    sequence: session.version,
    eventType: "call_room.data",
    eventVersion: 1,
    payload: {
      eventId: `call-room:${session.id}:worker.status:session-ended`,
      type: "worker.status",
      callId: session.id,
      roomName: session.callLink.roomName,
      segmentId: "session-ended",
      speakerRole: "worker",
      speaker: participantTrackSpeaker("worker"),
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "通话已结束",
      stage: "worker",
      retryable: false,
      timestampMs,
    },
  });
}

function validateInput(input: {
  userId: string;
  idempotencyKey: string;
  billableSeconds: number;
  note: string;
}) {
  if (!bounded(input.userId, 160) || !bounded(input.idempotencyKey, 200) ||
    !Number.isFinite(input.billableSeconds) || input.billableSeconds < 0 ||
    !bounded(input.note, 240)) {
    throw new Error("Invalid PostgreSQL session completion request");
  }
}

function normalizeSeconds(value: number) {
  return Math.max(0, Math.ceil(value));
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error &&
    (error as { code?: unknown }).code === "23505");
}
