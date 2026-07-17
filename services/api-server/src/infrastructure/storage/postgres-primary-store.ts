import type { Pool, PoolClient, QueryResultRow } from "pg";
import { applyPostgresProjectionEvent } from "./postgres-projection-apply.js";
import {
  PostgresReliableOutboxRepository,
  type PostgresOutboxEnqueueInput,
} from "./postgres-reliable-outbox.repository.js";

export interface PostgresAggregateFence {
  aggregateType: string;
  aggregateId: string;
  ownerId: string;
  fencingToken: number;
}

export interface PostgresPrimaryRecord<T = unknown> {
  namespace: string;
  recordKey: string;
  payload: T;
  recordVersion: number;
  updatedAt: string;
}

export class PostgresPrimaryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostgresPrimaryConflictError";
  }
}

export class PostgresPrimaryStore {
  private readonly outbox: PostgresReliableOutboxRepository;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.outbox = new PostgresReliableOutboxRepository(pool);
  }

  async withAggregateTransaction<T>(
    fence: PostgresAggregateFence,
    operation: (transaction: PostgresPrimaryTransaction) => Promise<T>,
  ) {
    validateFence(fence);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${fence.aggregateType}:${fence.aggregateId}`],
      );
      await client.query(
        "SELECT ai_phone.assert_aggregate_writer_fence($1, $2, $3, $4)",
        [
          fence.aggregateType,
          fence.aggregateId,
          fence.ownerId,
          fence.fencingToken,
        ],
      );
      const result = await operation(
        new PostgresPrimaryTransaction(client, this.outbox),
      );
      await client.query(
        "SELECT ai_phone.assert_aggregate_writer_fence($1, $2, $3, $4)",
        [
          fence.aggregateType,
          fence.aggregateId,
          fence.ownerId,
          fence.fencingToken,
        ],
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

  async read<T>(namespace: string, recordKey: string) {
    const client = await this.pool.connect();
    try {
      return await new PostgresPrimaryTransaction(client, this.outbox)
        .read<T>(namespace, recordKey);
    } finally {
      client.release();
    }
  }
}

export class PostgresPrimaryTransaction {
  constructor(
    private readonly client: Pick<PoolClient, "query">,
    private readonly outbox: PostgresReliableOutboxRepository,
  ) {}

  async read<T>(namespace: string, recordKey: string) {
    validateRecordIdentity(namespace, recordKey);
    return this.readRecord<T>(namespace, recordKey, false);
  }

  async mutate<T>(input: {
    eventId: string;
    namespace: string;
    recordKey: string;
    operation: "upsert" | "delete";
    payload?: T;
    expectedRecordVersion: number | null;
  }): Promise<PostgresPrimaryRecord<T> | null> {
    validateMutation(input);
    const replay = await this.replayStatus(input.eventId, input.payload ?? null);
    if (replay === "mismatch") {
      throw new PostgresPrimaryConflictError("Primary event payload conflict");
    }
    if (replay === "matched") {
      return this.readRecord<T>(input.namespace, input.recordKey, false);
    }
    const current = await this.readRecord<T>(input.namespace, input.recordKey, true);
    if (input.expectedRecordVersion === null ? current !== null
      : current?.recordVersion !== input.expectedRecordVersion) {
      throw new PostgresPrimaryConflictError("Primary record version conflict");
    }
    const applied = await applyPostgresProjectionEvent(this.client, {
      id: input.eventId,
      namespace: input.namespace,
      recordKey: input.recordKey,
      operation: input.operation,
      ...(input.operation === "upsert" ? { payload: input.payload } : {}),
    });
    if (!applied.applied) {
      const raced = await this.replayStatus(input.eventId, input.payload ?? null);
      if (raced !== "matched") {
        throw new PostgresPrimaryConflictError("Primary event replay conflict");
      }
    }
    return input.operation === "delete"
      ? null
      : this.readRecord<T>(input.namespace, input.recordKey, false);
  }

  enqueueOutbox(event: PostgresOutboxEnqueueInput) {
    return this.outbox.enqueue(this.client, event);
  }

  async callReliableInbox<Row extends QueryResultRow>(
    name: "reserve_reliable_inbox_event" | "complete_reliable_inbox_event",
    values: unknown[],
  ) {
    const parameters = values.map((_, index) => `$${index + 1}`).join(", ");
    const result = await this.client.query<Row>(
      `SELECT * FROM ai_phone.${name}(${parameters})`, values,
    );
    return result.rows;
  }

  async queryRead<Row extends QueryResultRow>(
    sql: string,
    values: unknown[] = [],
  ) {
    const normalized = sql.trim();
    if (!/^SELECT\b/i.test(normalized) || normalized.includes(";")) {
      throw new Error("PostgreSQL primary transaction only exposes SELECT reads");
    }
    const result = await this.client.query<Row>(normalized, values);
    return result.rows;
  }

  async readCommandResult<T>(input: PrimaryCommandIdentity) {
    validateCommandIdentity(input);
    const result = await this.client.query<PrimaryCommandRow>(`
      SELECT aggregate_type, aggregate_id, command_type, request_hash,
        result_payload
      FROM ai_phone.primary_command_inbox
      WHERE command_id = $1
      FOR UPDATE
    `, [input.commandId]);
    const row = result.rows[0];
    if (!row) return null;
    if (row.aggregate_type !== input.aggregateType ||
      row.aggregate_id !== input.aggregateId ||
      row.command_type !== input.commandType || row.request_hash !== input.requestHash) {
      throw new PostgresPrimaryConflictError("Primary command replay conflict");
    }
    return row.result_payload as T;
  }

  async recordCommandResult<T>(input: PrimaryCommandIdentity & {
    result: T;
    retainUntil: string;
  }) {
    validateCommandIdentity(input);
    if (!validFutureTimestamp(input.retainUntil)) {
      throw new Error("Invalid PostgreSQL primary command retention");
    }
    const payload = JSON.stringify(input.result);
    if (payload === undefined) {
      throw new Error("PostgreSQL primary command result must be JSON serializable");
    }
    const inserted = await this.client.query<{ command_id: string }>(`
      INSERT INTO ai_phone.primary_command_inbox(
        command_id, aggregate_type, aggregate_id, command_type, request_hash,
        result_payload, retain_until
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
      ON CONFLICT(command_id) DO NOTHING
      RETURNING command_id
    `, [
      input.commandId,
      input.aggregateType,
      input.aggregateId,
      input.commandType,
      input.requestHash,
      payload,
      input.retainUntil,
    ]);
    if (inserted.rowCount === 1) return { inserted: true, result: input.result };
    const replay = await this.client.query<PrimaryCommandReplayRow>(`
      SELECT result_payload,
        aggregate_type = $2 AND aggregate_id = $3 AND command_type = $4 AND
        request_hash = $5 AND result_payload = $6::jsonb AS matches
      FROM ai_phone.primary_command_inbox
      WHERE command_id = $1
      FOR UPDATE
    `, [
      input.commandId,
      input.aggregateType,
      input.aggregateId,
      input.commandType,
      input.requestHash,
      payload,
    ]);
    if (!replay.rows[0]?.matches) {
      throw new PostgresPrimaryConflictError("Primary command result conflict");
    }
    return { inserted: false, result: replay.rows[0].result_payload as T };
  }

  private async readRecord<T>(
    namespace: string,
    recordKey: string,
    lock: boolean,
  ): Promise<PostgresPrimaryRecord<T> | null> {
    const result = await this.client.query<PrimaryRecordRow>(`
      SELECT namespace, record_key, payload, record_version, updated_at
      FROM ai_phone.projection_records
      WHERE namespace = $1 AND record_key = $2
      ${lock ? "FOR UPDATE" : ""}
    `, [namespace, recordKey]);
    const row = result.rows[0];
    if (!row) return null;
    const recordVersion = Number(row.record_version);
    if (!Number.isSafeInteger(recordVersion) || recordVersion < 1) {
      throw new Error("Invalid PostgreSQL primary record version");
    }
    return {
      namespace: row.namespace,
      recordKey: row.record_key,
      payload: row.payload as T,
      recordVersion,
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private async replayStatus(eventId: string, payload: unknown) {
    const result = await this.client.query<{ matches: boolean }>(`
      SELECT payload_hash = md5(($2::jsonb)::text) AS matches
      FROM ai_phone.postgres_projection_inbox
      WHERE event_id = $1
    `, [eventId, JSON.stringify(payload)]);
    return !result.rows[0]
      ? "missing" as const
      : result.rows[0].matches ? "matched" as const : "mismatch" as const;
  }
}

interface PrimaryRecordRow {
  namespace: string;
  record_key: string;
  payload: unknown;
  record_version: string;
  updated_at: Date;
}

export interface PrimaryCommandIdentity {
  commandId: string;
  aggregateType: string;
  aggregateId: string;
  commandType: string;
  requestHash: string;
}

interface PrimaryCommandRow {
  aggregate_type: string;
  aggregate_id: string;
  command_type: string;
  request_hash: string;
  result_payload: unknown;
}

interface PrimaryCommandReplayRow {
  result_payload: unknown;
  matches: boolean;
}

function validateFence(value: PostgresAggregateFence) {
  if (!bounded(value.aggregateType, 80) || !bounded(value.aggregateId, 160) ||
    !bounded(value.ownerId, 160) || !Number.isSafeInteger(value.fencingToken) ||
    value.fencingToken < 1) throw new Error("Invalid PostgreSQL aggregate fence");
}

function validateCommandIdentity(value: PrimaryCommandIdentity) {
  if (!bounded(value.commandId, 200) || !bounded(value.aggregateType, 80) ||
    !bounded(value.aggregateId, 160) || !bounded(value.commandType, 100) ||
    !bounded(value.requestHash, 128) || value.requestHash.trim().length < 16) {
    throw new Error("Invalid PostgreSQL primary command identity");
  }
}

function validateMutation(value: {
  eventId: string;
  namespace: string;
  recordKey: string;
  operation: "upsert" | "delete";
  payload?: unknown;
  expectedRecordVersion: number | null;
}) {
  validateRecordIdentity(value.namespace, value.recordKey);
  if (!bounded(value.eventId, 200) ||
    (value.operation === "upsert" && value.payload === undefined) ||
    (value.operation === "delete" && value.payload !== undefined) ||
    (value.expectedRecordVersion !== null &&
      (!Number.isSafeInteger(value.expectedRecordVersion) ||
        value.expectedRecordVersion < 1))) {
    throw new Error("Invalid PostgreSQL primary mutation");
  }
}

function validateRecordIdentity(namespace: string, recordKey: string) {
  if (!bounded(namespace, 80) || !bounded(recordKey, 200)) {
    throw new Error("Invalid PostgreSQL primary record identity");
  }
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function validFutureTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}
