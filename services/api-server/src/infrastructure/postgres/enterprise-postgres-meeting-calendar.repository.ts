import type { EnterpriseMeetingCalendarSyncRecord } from
  "../../modules/enterprise/enterprise-meeting-calendar.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface CalendarSyncRow extends Record<string, unknown> {
  id: unknown; tenant_id: unknown; meeting_id: unknown; provider: unknown;
  status: unknown; scheduled_start_at: unknown; scheduled_end_at: unknown;
  provider_event_key: unknown; request_hash: unknown; idempotency_key: unknown;
  outbox_event_id: unknown; provider_event_id: unknown;
  provider_event_etag: unknown; provider_web_url: unknown;
  provider_response_hash: unknown; attempts: unknown; last_error_code: unknown;
  created_by: unknown; created_at: unknown; updated_at: unknown;
  synced_at: unknown; version: unknown;
}

export class EnterpriseMeetingCalendarPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  current(meetingId: string) {
    return this.session.query<CalendarSyncRow>(`
      SELECT * FROM enterprise.meeting_calendar_syncs
      WHERE tenant_id = $1 AND meeting_id = $2
      ORDER BY created_at DESC, id LIMIT 1
    `, [uuid(meetingId)]).then((result) => result.rows[0]
      ? map(result.rows[0], this.session.context.tenantId) : null);
  }

  byIdempotency(meetingId: string, idempotencyKey: string) {
    return this.session.query<CalendarSyncRow>(`
      SELECT * FROM enterprise.meeting_calendar_syncs
      WHERE tenant_id = $1 AND meeting_id = $2 AND idempotency_key = $3
    `, [uuid(meetingId), idempotencyKey]).then((result) => result.rows[0]
      ? map(result.rows[0], this.session.context.tenantId) : null);
  }

  byOutboxEvent(eventId: string) {
    return this.session.query<CalendarSyncRow>(`
      SELECT * FROM enterprise.meeting_calendar_syncs
      WHERE tenant_id = $1 AND outbox_event_id = $2
    `, [uuid(eventId)]).then((result) => result.rows[0]
      ? map(result.rows[0], this.session.context.tenantId) : null);
  }

  async create(input: {
    id: string; meetingId: string; provider: "google_calendar";
    scheduledStartAt: string; scheduledEndAt: string; providerEventKey: string;
    requestHash: string; idempotencyKey: string; outboxEventId: string; now: string;
  }) {
    const result = await this.session.query<CalendarSyncRow>(`
      INSERT INTO enterprise.meeting_calendar_syncs(
        tenant_id, id, meeting_id, provider, status, scheduled_start_at,
        scheduled_end_at, provider_event_key, request_hash, idempotency_key,
        outbox_event_id, attempts, created_by, created_at, updated_at, version
      ) VALUES (
        $1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, 0, $11, $12, $12, 1
      ) ON CONFLICT DO NOTHING RETURNING *
    `, [input.id, input.meetingId, input.provider, input.scheduledStartAt,
      input.scheduledEndAt, input.providerEventKey, input.requestHash,
      input.idempotencyKey, input.outboxEventId,
      this.session.context.actorUserId, input.now]);
    if (result.rows[0]) return { status: "created" as const,
      sync: map(result.rows[0], this.session.context.tenantId) };
    const existing = await this.session.query<CalendarSyncRow>(`
      SELECT * FROM enterprise.meeting_calendar_syncs
      WHERE tenant_id = $1 AND (
        (meeting_id = $2 AND provider = $3) OR
        (meeting_id = $2 AND idempotency_key = $4)
      ) ORDER BY created_at, id LIMIT 1
    `, [input.meetingId, input.provider, input.idempotencyKey]);
    const sync = existing.rows[0]
      ? map(existing.rows[0], this.session.context.tenantId) : null;
    if (!sync) throw new Error("Meeting calendar sync conflict row missing");
    if (sync.idempotencyKey === input.idempotencyKey) return (
      sync.requestHash === input.requestHash &&
        sync.createdBy === this.session.context.actorUserId
        ? { status: "replayed" as const, sync }
        : { status: "idempotency_conflict" as const }
    );
    return { status: "conflict" as const, sync };
  }

  async finalize(input: { syncId: string; outboxEventId: string; attempt: number;
    result: { status: "retry"; reasonCode: string } |
      { status: "failed"; reasonCode: string } |
      { status: "synced"; providerEventId: string; providerEventEtag: string;
        providerWebUrl: string; providerResponseHash: string };
    now: string }) {
    const result = input.result;
    const updated = await this.session.query<CalendarSyncRow>(`
      UPDATE enterprise.meeting_calendar_syncs SET
        status = $4, attempts = $5, last_error_code = $6,
        provider_event_id = $7, provider_event_etag = $8,
        provider_web_url = $9, provider_response_hash = $10,
        synced_at = $11, updated_at = $12, version = version + 1
      WHERE tenant_id = $1 AND outbox_event_id = $2 AND status = 'pending'
        AND attempts < $3 AND id = $13 RETURNING *
    `, [uuid(input.outboxEventId), input.attempt,
      result.status === "synced" ? "synced" :
        result.status === "failed" ? "failed" : "pending",
      input.attempt, result.status === "synced" ? null : code(result.reasonCode),
      result.status === "synced" ? bounded(result.providerEventId, 1_024) : null,
      result.status === "synced" ? bounded(result.providerEventEtag, 512) : null,
      result.status === "synced" ? webUrl(result.providerWebUrl) : null,
      result.status === "synced" ? hash(result.providerResponseHash) : null,
      result.status === "synced" ? input.now : null, input.now,
      uuid(input.syncId)]);
    return updated.rows[0]
      ? { status: "updated" as const,
          sync: map(updated.rows[0], this.session.context.tenantId) }
      : { status: "conflict" as const };
  }
}

function map(row: CalendarSyncRow, tenantId: string): EnterpriseMeetingCalendarSyncRecord {
  if (required(row.tenant_id) !== tenantId) throw new Error(
    "Meeting calendar sync tenant mismatch",
  );
  if (required(row.provider) !== "google_calendar") throw invalid();
  const status = required(row.status);
  if (!["pending", "synced", "failed"].includes(status)) throw invalid();
  return { id: uuid(required(row.id)), tenantId,
    meetingId: uuid(required(row.meeting_id)), provider: "google_calendar",
    status: status as EnterpriseMeetingCalendarSyncRecord["status"],
    scheduledStartAt: timestamp(row.scheduled_start_at),
    scheduledEndAt: timestamp(row.scheduled_end_at),
    providerEventKey: eventKey(row.provider_event_key),
    requestHash: hash(row.request_hash), idempotencyKey: required(row.idempotency_key),
    outboxEventId: uuid(required(row.outbox_event_id)),
    ...(optional(row.provider_event_id) ?
      { providerEventId: required(row.provider_event_id) } : {}),
    ...(optional(row.provider_event_etag) ?
      { providerEventEtag: required(row.provider_event_etag) } : {}),
    ...(optional(row.provider_web_url) ?
      { providerWebUrl: webUrl(required(row.provider_web_url)) } : {}),
    ...(optional(row.provider_response_hash) ?
      { providerResponseHash: hash(row.provider_response_hash) } : {}),
    attempts: nonnegative(row.attempts),
    ...(optional(row.last_error_code) ?
      { lastErrorCode: code(required(row.last_error_code)) } : {}),
    createdBy: required(row.created_by), createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    ...(optional(row.synced_at) ? { syncedAt: timestamp(row.synced_at) } : {}),
    version: positive(row.version) };
}
function required(value: unknown) { if (typeof value !== "string" || !value) throw invalid();
  return value; }
function optional(value: unknown) { return value !== null && value !== undefined; }
function positive(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw invalid(); return number; }
function nonnegative(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid(); return number; }
function timestamp(value: unknown) { const text = value instanceof Date
  ? value.toISOString() : required(value); if (!Number.isFinite(Date.parse(text))) throw invalid();
  return new Date(text).toISOString(); }
function uuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  .test(value)) throw invalid(); return value; }
function eventKey(value: unknown) { const text = required(value);
  if (!/^[a-v0-9]{5,64}$/.test(text)) throw invalid(); return text; }
function hash(value: unknown) { const text = required(value);
  if (!/^[a-f0-9]{64}$/.test(text)) throw invalid(); return text; }
function code(value: string) { if (!/^[a-z][a-z0-9_]{1,63}$/.test(value)) throw invalid();
  return value; }
function bounded(value: string, maximum: number) { if (!value ||
  Buffer.byteLength(value) > maximum) throw invalid(); return value; }
function webUrl(value: string) { if (Buffer.byteLength(value) > 2_048) throw invalid();
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username ||
    url.password) throw invalid(); return url.toString(); } catch { throw invalid(); } }
function invalid() { return new Error("Invalid meeting calendar sync row"); }
