import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { PostgresPrimaryTransaction } from "./postgres-primary-store.js";

export class PostgresInboxPayloadConflictError extends Error {
  constructor(readonly eventId: string) {
    super(`PostgreSQL inbox event payload changed for ${eventId}`);
    this.name = "PostgresInboxPayloadConflictError";
  }
}

export class PostgresInboxBusyError extends Error {
  constructor(readonly eventId: string) {
    super(`PostgreSQL inbox event is already claimed: ${eventId}`);
    this.name = "PostgresInboxBusyError";
  }
}

export class PostgresInboxLeaseLostError extends Error {
  constructor(readonly eventId: string) {
    super(`PostgreSQL inbox event lease was lost: ${eventId}`);
    this.name = "PostgresInboxLeaseLostError";
  }
}

export class PostgresReliableInboxRepository {
  constructor(private readonly pool?: Pick<Pool, "connect">) {}

  async process<T>(
    transaction: PostgresPrimaryTransaction,
    input: {
      eventId: string;
      sessionId: string;
      eventType: string;
      payload: unknown;
      retainUntil?: string;
    },
    process: () => Promise<T> | T,
  ) {
    validateInput(input);
    const payloadHash = hashPayload(input.payload);
    const retainUntil = input.retainUntil ??
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();
    if (!validFutureTimestamp(retainUntil)) {
      throw new Error("Invalid PostgreSQL inbox retention timestamp");
    }
    const reservations = await transaction.callReliableInbox<InboxInsertRow>(
      "reserve_reliable_inbox_event",
      [
      input.eventId,
      input.sessionId,
      input.eventType,
      payloadHash,
      retainUntil,
      ],
    );
    const reservation = reservations[0];
    if (!reservation) throw new Error("PostgreSQL inbox reservation returned no row");
    if (!reservation.inserted) {
      const replay = await transaction.queryRead<InboxReplayRow>(`
        SELECT session_id, event_type, payload_hash, result_payload, processed_at
        FROM ai_phone.reliable_inbox_events
        WHERE event_id = $1
        FOR UPDATE
      `, [input.eventId]);
      const row = replay[0];
      if (!row || row.session_id !== input.sessionId ||
        row.event_type !== input.eventType || row.payload_hash !== payloadHash) {
        throw new PostgresInboxPayloadConflictError(input.eventId);
      }
      if (!row.processed_at || row.result_payload === null) {
        throw new Error("PostgreSQL inbox event is reserved but not processed");
      }
      return { duplicate: true as const, result: decodeResult<T>(row.result_payload) };
    }
    const result = await process();
    const resultPayload = JSON.stringify({
      defined: result !== undefined,
      value: result ?? null,
    });
    const updated = await transaction.callReliableInbox<InboxProcessedRow>(
      "complete_reliable_inbox_event",
      [input.eventId, resultPayload],
    );
    if (updated.length !== 1) {
      throw new Error("PostgreSQL inbox event could not be completed");
    }
    return { duplicate: false as const, result };
  }

  async claim<T>(input: {
    eventId: string;
    sessionId: string;
    eventType: string;
    payload: unknown;
    claimOwner: string;
    leaseSeconds: number;
    retainUntil?: string;
  }) {
    validateInput(input);
    validateClaim(input.claimOwner, input.leaseSeconds);
    const payloadHash = hashPayload(input.payload);
    const retainUntil = input.retainUntil ??
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();
    if (!validFutureTimestamp(retainUntil)) {
      throw new Error("Invalid PostgreSQL inbox retention timestamp");
    }
    const client = await this.requiredPool().connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ event_id: string }>(`
        INSERT INTO ai_phone.reliable_inbox_events(
          event_id, session_id, event_type, payload_hash, retain_until,
          lease_owner, lease_until, attempts
        ) VALUES ($1, $2, $3, $4, $5, $6,
          now() + make_interval(secs => $7), 1)
        ON CONFLICT(event_id) DO NOTHING RETURNING event_id
      `, [input.eventId, input.sessionId, input.eventType, payloadHash,
        retainUntil, input.claimOwner, input.leaseSeconds]);
      const selected = await client.query<ClaimRow>(`
        SELECT session_id, event_type, payload_hash, result_payload,
          processed_at, lease_owner, lease_until > now() AS lease_active
        FROM ai_phone.reliable_inbox_events
        WHERE event_id = $1 FOR UPDATE
      `, [input.eventId]);
      const row = selected.rows[0];
      if (!row || row.session_id !== input.sessionId ||
        row.event_type !== input.eventType || row.payload_hash !== payloadHash) {
        throw new PostgresInboxPayloadConflictError(input.eventId);
      }
      if (row.processed_at) {
        await client.query("COMMIT");
        return { duplicate: true as const, result: decodeResult<T>(row.result_payload) };
      }
      if (inserted.rowCount !== 1 && row.lease_owner && row.lease_active) {
        throw new PostgresInboxBusyError(input.eventId);
      }
      if (inserted.rowCount !== 1) {
        await client.query(`
          UPDATE ai_phone.reliable_inbox_events
          SET lease_owner = $2,
            lease_until = now() + make_interval(secs => $3),
            attempts = attempts + 1
          WHERE event_id = $1 AND processed_at IS NULL
        `, [input.eventId, input.claimOwner, input.leaseSeconds]);
      }
      await client.query("COMMIT");
      return { duplicate: false as const, result: undefined };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeClaim<T>(input: {
    eventId: string;
    claimOwner: string;
    result: T;
    beforeComplete?: (client: Pick<PoolClient, "query">) => Promise<void>;
  }) {
    const client = await this.requiredPool().connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<LeaseRow>(`
        SELECT lease_owner, lease_until > now() AS lease_active, processed_at
        FROM ai_phone.reliable_inbox_events
        WHERE event_id = $1 FOR UPDATE
      `, [input.eventId]);
      const row = selected.rows[0];
      if (!row || row.processed_at || row.lease_owner !== input.claimOwner ||
        !row.lease_active) throw new PostgresInboxLeaseLostError(input.eventId);
      await input.beforeComplete?.(client);
      const resultPayload = JSON.stringify({
        defined: input.result !== undefined,
        value: input.result ?? null,
      });
      const updated = await client.query(`
        UPDATE ai_phone.reliable_inbox_events
        SET result_payload = $3::jsonb, processed_at = now(),
          lease_owner = NULL, lease_until = NULL
        WHERE event_id = $1 AND lease_owner = $2 AND lease_until > now()
          AND processed_at IS NULL
        RETURNING event_id
      `, [input.eventId, input.claimOwner, resultPayload]);
      if (updated.rowCount !== 1) {
        throw new PostgresInboxLeaseLostError(input.eventId);
      }
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async abandon(eventId: string, claimOwner: string) {
    const client = await this.requiredPool().connect();
    try {
      const result = await client.query(`
        UPDATE ai_phone.reliable_inbox_events
        SET lease_owner = NULL, lease_until = NULL
        WHERE event_id = $1 AND lease_owner = $2 AND processed_at IS NULL
      `, [eventId, claimOwner]);
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }

  async has(eventId: string) {
    const client = await this.requiredPool().connect();
    try {
      const result = await client.query(
        "SELECT 1 FROM ai_phone.reliable_inbox_events WHERE event_id = $1",
        [eventId],
      );
      return result.rowCount === 1;
    } finally {
      client.release();
    }
  }

  private requiredPool() {
    if (!this.pool) throw new Error("PostgreSQL inbox pool is not configured");
    return this.pool;
  }
}

function validateInput(input: {
  eventId: string;
  sessionId: string;
  eventType: string;
}) {
  if (!bounded(input.eventId, 200) || !bounded(input.sessionId, 160) ||
    !bounded(input.eventType, 120) || input.eventType.trim().length < 2) {
    throw new Error("Invalid PostgreSQL inbox event");
  }
}

function validateClaim(owner: string, leaseSeconds: number) {
  if (!bounded(owner, 200) || owner.length < 8 ||
    !Number.isInteger(leaseSeconds) || leaseSeconds < 5 || leaseSeconds > 300) {
    throw new Error("Invalid PostgreSQL inbox claim");
  }
}

function hashPayload(payload: unknown) {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, item]) => `${JSON.stringify(name)}:${stableJson(item)}`).join(",")}}`;
}

function bounded(value: string, maximum: number) {
  return value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function validFutureTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function decodeResult<T>(value: unknown) {
  if (!value || typeof value !== "object" || !("defined" in value) ||
    !("value" in value)) {
    throw new Error("Invalid PostgreSQL inbox result envelope");
  }
  const envelope = value as { defined: unknown; value: unknown };
  if (typeof envelope.defined !== "boolean") {
    throw new Error("Invalid PostgreSQL inbox result envelope");
  }
  return (envelope.defined ? envelope.value : undefined) as T;
}

interface InboxInsertRow extends QueryResultRow {
  event_id: string;
  inserted: boolean;
}

interface InboxReplayRow extends QueryResultRow {
  session_id: string;
  event_type: string;
  payload_hash: string;
  result_payload: unknown | null;
  processed_at: Date | null;
}

interface InboxProcessedRow extends QueryResultRow {
  event_id: string;
}

interface ClaimRow extends InboxReplayRow {
  lease_owner: string | null;
  lease_active: boolean;
}

interface LeaseRow extends QueryResultRow {
  lease_owner: string | null;
  lease_active: boolean;
  processed_at: Date | null;
}
