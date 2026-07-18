import type { Pool, PoolClient } from "pg";

export interface PostgresOutboxEvent {
  id: string;
  idempotencyKey: string;
  sessionId?: string;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  attempts: number;
  leaseOwner?: string;
  leaseUntil?: string;
}

export interface PostgresOutboxEnqueueInput {
  id: string;
  idempotencyKey: string;
  sessionId?: string;
  aggregateVersion?: number;
  sequence?: number;
  eventType: string;
  eventVersion: number;
  payload: unknown;
  availableAt?: string;
}

export class PostgresOutboxConflictError extends Error {
  constructor() {
    super("PostgreSQL outbox idempotency conflict");
    this.name = "PostgresOutboxConflictError";
  }
}

export class PostgresReliableOutboxRepository {
  constructor(private readonly pool: Pick<Pool, "connect">) {}

  async enqueue(
    client: Pick<PoolClient, "query">,
    event: PostgresOutboxEnqueueInput,
  ) {
    const result = await client.query<{ id: string }>(`
      INSERT INTO ai_phone.reliable_outbox_events(
        id, idempotency_key, session_id, aggregate_version, sequence,
        event_type, event_version, payload, available_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
        COALESCE($9::timestamptz, now())
      )
      ON CONFLICT(idempotency_key) DO NOTHING
      RETURNING id
    `, [
      event.id,
      event.idempotencyKey,
      event.sessionId,
      event.aggregateVersion,
      event.sequence,
      event.eventType,
      event.eventVersion,
      JSON.stringify(event.payload),
      event.availableAt,
    ]);
    if (result.rowCount === 1) {
      return { inserted: true, id: result.rows[0]!.id };
    }
    const replay = await client.query<{ id: string; matches: boolean }>(`
      SELECT id,
        id = $1 AND
        session_id IS NOT DISTINCT FROM $3 AND
        aggregate_version IS NOT DISTINCT FROM $4 AND
        sequence IS NOT DISTINCT FROM $5 AND
        event_type = $6 AND event_version = $7 AND payload = $8::jsonb AND
        CASE WHEN $9::text IS NULL THEN true ELSE available_at = $9::timestamptz END
        AS matches
      FROM ai_phone.reliable_outbox_events
      WHERE idempotency_key = $2
    `, [
      event.id,
      event.idempotencyKey,
      event.sessionId,
      event.aggregateVersion,
      event.sequence,
      event.eventType,
      event.eventVersion,
      JSON.stringify(event.payload),
      event.availableAt,
    ]);
    if (!replay.rows[0]?.matches) throw new PostgresOutboxConflictError();
    return { inserted: false, id: replay.rows[0].id };
  }

  async claim(owner: string, limit: number, leaseSeconds: number) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<OutboxRow>(
        "SELECT * FROM ai_phone.claim_reliable_outbox($1, $2, $3)",
        [owner, limit, leaseSeconds],
      );
      await client.query("COMMIT");
      return rows.rows.map(fromRow);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimMatching(input: {
    owner: string;
    limit: number;
    leaseSeconds: number;
    sessionId?: string;
    eventType?: string;
    now?: Date;
  }) {
    validateClaim(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const rows = await client.query<OutboxRow>(`
        WITH candidates AS (
          SELECT id FROM ai_phone.reliable_outbox_events
          WHERE published_at IS NULL AND dead_lettered_at IS NULL
            AND available_at <= $6::timestamptz
            AND (lease_until IS NULL OR lease_until <= now())
            AND ($4::text IS NULL OR session_id = $4)
            AND ($5::text IS NULL OR event_type = $5)
          ORDER BY available_at, created_at, id
          FOR UPDATE SKIP LOCKED LIMIT $2
        )
        UPDATE ai_phone.reliable_outbox_events AS event
        SET lease_owner = $1,
          lease_until = now() + make_interval(secs => $3),
          attempts = event.attempts + 1
        FROM candidates WHERE event.id = candidates.id RETURNING event.*
      `, [input.owner, input.limit, input.leaseSeconds,
        input.sessionId, input.eventType, (input.now ?? new Date()).toISOString()]);
      await client.query("COMMIT");
      return rows.rows.map(fromRow);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listPendingSessionIds(eventType: string, now = new Date(), limit = 200) {
    if (!eventType.trim() || !Number.isInteger(limit) || limit < 1 || limit > 500 ||
      !Number.isFinite(now.getTime())) throw new Error("Invalid outbox session query");
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ session_id: string }>(`
        SELECT session_id, min(available_at) AS first_available
        FROM ai_phone.reliable_outbox_events
        WHERE event_type = $1 AND session_id IS NOT NULL
          AND published_at IS NULL AND dead_lettered_at IS NULL
          AND available_at <= $2::timestamptz
          AND (lease_until IS NULL OR lease_until <= now())
        GROUP BY session_id ORDER BY first_available, session_id LIMIT $3
      `, [eventType, now.toISOString(), limit]);
      return result.rows.map((row) => row.session_id);
    } finally {
      client.release();
    }
  }

  async acknowledge(id: string, owner: string) {
    const result = await this.withLease(id, owner, `
      UPDATE ai_phone.reliable_outbox_events
      SET published_at = now(), lease_owner = NULL, lease_until = NULL
      WHERE id = $1 AND lease_owner = $2 AND lease_until > now()
      RETURNING id
    `);
    return result;
  }

  async fail(id: string, owner: string, deadLetterAfter = 12) {
    return this.withLease(id, owner, `
      UPDATE ai_phone.reliable_outbox_events
      SET lease_owner = NULL,
          lease_until = NULL,
          available_at = now() + make_interval(
            secs => LEAST(300, power(2, LEAST(8, attempts))::integer)
          ),
          dead_lettered_at = CASE WHEN attempts >= $3 THEN now()
            ELSE dead_lettered_at END
      WHERE id = $1 AND lease_owner = $2 AND lease_until > now()
      RETURNING id
    `, deadLetterAfter);
  }

  async release(id: string, owner: string) {
    return this.withLease(id, owner, `
      UPDATE ai_phone.reliable_outbox_events
      SET lease_owner = NULL, lease_until = NULL,
          attempts = GREATEST(0, attempts - 1)
      WHERE id = $1 AND lease_owner = $2 AND lease_until > now()
        AND published_at IS NULL AND dead_lettered_at IS NULL
      RETURNING id
    `);
  }

  private async withLease(
    id: string,
    owner: string,
    sql: string,
    third?: number,
  ) {
    const client = await this.pool.connect();
    try {
      const result = await client.query<{ id: string }>(
        sql,
        third === undefined ? [id, owner] : [id, owner, third],
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }
}

function validateClaim(input: {
  owner: string;
  limit: number;
  leaseSeconds: number;
  sessionId?: string;
  eventType?: string;
  now?: Date;
}) {
  if (input.owner.trim().length < 8 || Buffer.byteLength(input.owner) > 200 ||
    !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200 ||
    !Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 5 ||
    input.leaseSeconds > 300 || (input.sessionId !== undefined &&
      (!input.sessionId.trim() || Buffer.byteLength(input.sessionId) > 160)) ||
    (input.eventType !== undefined && (!input.eventType.trim() ||
      Buffer.byteLength(input.eventType) > 120)) ||
    (input.now !== undefined && !Number.isFinite(input.now.getTime()))) {
    throw new Error("Invalid outbox claim parameters");
  }
}

interface OutboxRow {
  id: string;
  idempotency_key: string;
  session_id: string | null;
  event_type: string;
  event_version: number;
  payload: unknown;
  attempts: number;
  lease_owner: string | null;
  lease_until: Date | null;
}

function fromRow(row: OutboxRow): PostgresOutboxEvent {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    ...(row.session_id ? { sessionId: row.session_id } : {}),
    eventType: row.event_type,
    eventVersion: row.event_version,
    payload: row.payload,
    attempts: row.attempts,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_until ? { leaseUntil: row.lease_until.toISOString() } : {}),
  };
}
