import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PostgresPrimaryTransaction } from "./postgres-primary-store.js";

export class PostgresInboxPayloadConflictError extends Error {
  constructor(readonly eventId: string) {
    super(`PostgreSQL inbox event payload changed for ${eventId}`);
    this.name = "PostgresInboxPayloadConflictError";
  }
}

export class PostgresReliableInboxRepository {
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
}

function validateInput(input: {
  eventId: string;
  sessionId: string;
  eventType: string;
}) {
  if (!bounded(input.eventId, 200) || !bounded(input.sessionId, 160) ||
    !bounded(input.eventType, 120)) {
    throw new Error("Invalid PostgreSQL inbox event");
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
