import type { Pool, PoolClient } from "pg";
import { domainEventId } from
  "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  PostgresPrimaryTransaction,
  type PrimaryCommandIdentity,
} from "../../infrastructure/storage/postgres-primary-store.js";
import { PostgresReliableOutboxRepository } from
  "../../infrastructure/storage/postgres-reliable-outbox.repository.js";
import {
  agentWorkFromRow,
  AgentWorkValidationError,
  type AgentWorkRecord,
  type AgentWorkRow,
  type normalizeAgentWorkCreateInput,
} from "./agent-work-record.js";

const commandRetentionMs = 90 * 24 * 60 * 60 * 1_000;

export class AgentWorkPostgresSupport {
  private readonly outbox: PostgresReliableOutboxRepository;

  constructor(readonly pool: Pick<Pool, "connect">) {
    this.outbox = new PostgresReliableOutboxRepository(pool);
  }

  async transaction<T>(
    operation: (
      client: Pick<PoolClient, "query">,
      transaction: PostgresPrimaryTransaction,
    ) => Promise<T>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(
        client,
        new PostgresPrimaryTransaction(client, this.outbox),
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class AgentWorkConflictError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentWorkConflictError";
  }
}

export interface WorkCommandResult {
  status: string;
  workId: string;
  version: number;
}

export function workCommand(
  commandId: string,
  workId: string,
  commandType: string,
  requestHash: string,
): PrimaryCommandIdentity {
  return {
    commandId,
    aggregateType: "agent_work",
    aggregateId: workId,
    commandType,
    requestHash,
  };
}

export async function recordWorkCommand(
  transaction: PostgresPrimaryTransaction,
  command: PrimaryCommandIdentity,
  result: WorkCommandResult,
  now: Date,
) {
  await transaction.recordCommandResult({
    ...command,
    result,
    retainUntil: new Date(now.getTime() + commandRetentionMs).toISOString(),
  });
}

export async function enqueueWorkEvent(
  transaction: PostgresPrimaryTransaction,
  eventIdentity: string,
  eventType: string,
  work: AgentWorkRecord,
  now: Date,
) {
  const eventId = domainEventId(eventIdentity, eventType);
  await transaction.enqueueOutbox({
    id: eventId,
    idempotencyKey: eventId,
    sessionId: work.sessionId,
    aggregateVersion: work.version,
    sequence: work.version,
    eventType,
    eventVersion: 1,
    payload: {
      workId: work.workId,
      agentRunId: work.agentRunId,
      sessionId: work.sessionId,
      legId: work.legId,
      turnId: work.turnId,
      turnGeneration: work.turnGeneration,
      dispatchGeneration: work.dispatchGeneration,
      priority: work.priority,
      status: work.status,
      attempt: work.attempt,
      version: work.version,
      occurredAt: now.toISOString(),
      ...(work.failureCode ? { failureCode: work.failureCode } : {}),
      ...(work.lastErrorCode ? { lastErrorCode: work.lastErrorCode } : {}),
      ...(work.cancellationReason
        ? { cancellationReason: work.cancellationReason }
        : {}),
    },
  });
}

export async function findCreateConflict(
  client: Pick<PoolClient, "query">,
  input: ReturnType<typeof normalizeAgentWorkCreateInput>,
) {
  const result = await client.query<AgentWorkRow>(`
    SELECT * FROM ai_phone.agent_works
    WHERE work_id = $1 OR (
      session_id = $2 AND actor_id = $3 AND tool_name = $4
        AND submission_key = $5
    ) FOR UPDATE
  `, [
    input.workId,
    input.sessionId,
    input.actorId,
    input.payload.toolName,
    input.payload.submissionKey,
  ]);
  if (result.rows.length > 1) {
    throw new AgentWorkConflictError("work_identity_conflict");
  }
  return result.rows[0];
}

export async function requireWork(
  client: Pick<PoolClient, "query">,
  workId: string,
  forUpdate = false,
) {
  const result = await client.query<AgentWorkRow>(`
    SELECT * FROM ai_phone.agent_works WHERE work_id = $1
    ${forUpdate ? "FOR UPDATE" : ""}
  `, [workId]);
  if (!result.rows[0]) throw new AgentWorkConflictError("work_not_found");
  return agentWorkFromRow(result.rows[0]);
}

export function assertWorkClaim(
  work: AgentWorkRecord,
  claimId: string,
  owner: string,
  now: Date,
) {
  const runtimeDeadline = work.startedAt
    ? Date.parse(work.startedAt) + work.maxRuntimeMs
    : Number.POSITIVE_INFINITY;
  const cancellationDeadline = work.cancelDeadlineAt
    ? Date.parse(work.cancelDeadlineAt)
    : Number.POSITIVE_INFINITY;
  if (!work.claim || work.claim.claimId !== claimId || work.claim.owner !== owner ||
      Date.parse(work.claim.expiresAt) <= now.getTime() ||
      Date.parse(work.expiresAt) <= now.getTime() ||
      runtimeDeadline <= now.getTime() ||
      cancellationDeadline <= now.getTime()) {
    throw new AgentWorkConflictError("work_claim_invalid");
  }
}

export function assertWorkCancelScope(
  work: AgentWorkRecord,
  input: {
    sessionId: string;
    actorId: string;
    turnGeneration: number;
    dispatchGeneration: number;
  },
) {
  if (work.sessionId !== input.sessionId || work.actorId !== input.actorId) {
    throw new AgentWorkConflictError("work_owner_scope_conflict");
  }
  if (work.turnGeneration !== input.turnGeneration) {
    throw new AgentWorkConflictError("stale_turn_generation");
  }
  if (work.dispatchGeneration !== input.dispatchGeneration) {
    throw new AgentWorkConflictError("stale_dispatch_generation");
  }
}

export function submissionLock(
  input: ReturnType<typeof normalizeAgentWorkCreateInput>,
) {
  return ["agent-work-submission", input.sessionId, input.actorId,
    input.payload.toolName, input.payload.submissionKey].join(":");
}

export function lockWork(
  client: Pick<PoolClient, "query">,
  identity: string,
) {
  return client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [identity],
  );
}

export function boundedWorkValue(
  value: string,
  name: string,
  maximum: number,
  minimum = 1,
) {
  if (typeof value !== "string" || value.trim().length < minimum ||
      Buffer.byteLength(value) > maximum) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value.trim();
}

export function boundedWorkInteger(
  value: number,
  name: string,
  minimum: number,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value;
}

export function validWorkDate(value: Date, name: string) {
  if (!Number.isFinite(value.getTime())) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value;
}

export function boundedWorkJson(
  value: unknown,
  name: string,
  maximumBytes: number,
) {
  if (value === undefined) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  if (serialized === undefined || Buffer.byteLength(serialized) > maximumBytes) {
    throw new AgentWorkValidationError(`${name}_invalid`);
  }
  return value;
}
