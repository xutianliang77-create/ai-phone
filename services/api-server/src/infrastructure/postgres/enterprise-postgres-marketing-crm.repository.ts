import type { EnterpriseMarketingCrmSyncRecord } from
  "../../modules/enterprise/enterprise-marketing-crm.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface Row extends Record<string, unknown> {
  id: unknown; tenant_id: unknown; campaign_id: unknown; outcome_id: unknown;
  provider: unknown; status: unknown; external_record_key: unknown;
  object_api_name: unknown; payload_hash: unknown; provider_fingerprint: unknown;
  request_hash: unknown; idempotency_key: unknown; outbox_event_id: unknown;
  provider_record_id: unknown; provider_record_url: unknown;
  provider_response_hash: unknown; attempts: unknown; last_error_code: unknown;
  created_by: unknown; created_at: unknown; updated_at: unknown; synced_at: unknown;
  version: unknown; sync_count?: unknown; pending_count?: unknown;
  synced_count?: unknown; failed_count?: unknown;
}

export class EnterpriseMarketingCrmPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}
  async list(campaignId: string, limit = 100) {
    const result = await this.session.query<Row>(`
      SELECT sync.*, count(*) OVER() AS sync_count,
        count(*) FILTER (WHERE status = 'pending') OVER() AS pending_count,
        count(*) FILTER (WHERE status = 'synced') OVER() AS synced_count,
        count(*) FILTER (WHERE status = 'failed') OVER() AS failed_count
      FROM enterprise.marketing_crm_syncs sync
      WHERE sync.tenant_id = $1 AND sync.campaign_id = $2
      ORDER BY sync.created_at DESC, sync.id DESC LIMIT $3
    `, [uuid(campaignId), integer(limit, 1, 101)]);
    const records = result.rows.map((row) => map(row, this.session.context.tenantId));
    const row = result.rows[0];
    return { records, count: row ? nonnegative(row.sync_count) : 0,
      counts: { pending: row ? nonnegative(row.pending_count) : 0,
        synced: row ? nonnegative(row.synced_count) : 0,
        failed: row ? nonnegative(row.failed_count) : 0 } };
  }
  byIdempotency(actorUserId: string, idempotencyKey: string) {
    return this.one(`created_by = $2 AND idempotency_key = $3`,
      [actor(actorUserId), key(idempotencyKey)]);
  }
  byOutcome(outcomeId: string) { return this.one(`outcome_id = $2`, [uuid(outcomeId)]); }
  byOutboxEvent(eventId: string) { return this.one(`outbox_event_id = $2`,
    [uuid(eventId)]); }
  private async one(where: string, values: unknown[]) {
    const result = await this.session.query<Row>(`
      SELECT * FROM enterprise.marketing_crm_syncs
      WHERE tenant_id = $1 AND ${where} LIMIT 1
    `, values);
    return result.rows[0] ? map(result.rows[0], this.session.context.tenantId) : null;
  }
  async create(input: { id: string; campaignId: string; outcomeId: string;
    externalRecordKey: string; objectApiName: string; payloadHash: string;
    providerFingerprint: string; requestHash: string; idempotencyKey: string;
    outboxEventId: string; now: string }) {
    const result = await this.session.query<Row>(`
      INSERT INTO enterprise.marketing_crm_syncs(
        tenant_id, id, campaign_id, outcome_id, provider, status,
        external_record_key, object_api_name, payload_hash, provider_fingerprint,
        request_hash, idempotency_key, outbox_event_id, attempts, created_by,
        created_at, updated_at, version
      ) VALUES ($1,$2,$3,$4,'salesforce','pending',$5,$6,$7,$8,$9,$10,$11,0,
        $12,$13,$13,1)
      ON CONFLICT DO NOTHING RETURNING *
    `, [uuid(input.id), uuid(input.campaignId), uuid(input.outcomeId),
      externalKey(input.externalRecordKey), apiName(input.objectApiName),
      hash(input.payloadHash), hash(input.providerFingerprint), hash(input.requestHash),
      key(input.idempotencyKey), uuid(input.outboxEventId),
      actor(this.session.context.actorUserId), iso(input.now)]);
    if (result.rows[0]) return { status: "created" as const,
      sync: map(result.rows[0], this.session.context.tenantId) };
    const byKey = await this.byIdempotency(this.session.context.actorUserId,
      input.idempotencyKey);
    if (byKey) return byKey.requestHash === input.requestHash
      ? { status: "replayed" as const, sync: byKey }
      : { status: "idempotency_conflict" as const };
    const byOutcome = await this.byOutcome(input.outcomeId);
    return byOutcome ? { status: "already_requested" as const, sync: byOutcome }
      : { status: "conflict" as const };
  }
  async finalize(input: { syncId: string; outboxEventId: string; attempt: number;
    result: { status: "retry"; reasonCode: string } |
      { status: "failed"; reasonCode: string } |
      { status: "synced"; providerRecordId: string; providerRecordUrl: string;
        providerResponseHash: string }; now: string }) {
    const value = input.result;
    const result = await this.session.query<Row>(`
      UPDATE enterprise.marketing_crm_syncs SET status = $4, attempts = $5,
        last_error_code = $6, provider_record_id = $7, provider_record_url = $8,
        provider_response_hash = $9, synced_at = $10, updated_at = $11,
        version = version + 1
      WHERE tenant_id = $1 AND outbox_event_id = $2 AND attempts < $3
        AND status = 'pending' AND id = $12 RETURNING *
    `, [uuid(input.outboxEventId), integer(input.attempt, 1, 1_000_000),
      value.status === "synced" ? "synced" : value.status === "failed" ? "failed" :
        "pending", input.attempt, value.status === "synced" ? null : code(value.reasonCode),
      value.status === "synced" ? recordId(value.providerRecordId) : null,
      value.status === "synced" ? webUrl(value.providerRecordUrl) : null,
      value.status === "synced" ? hash(value.providerResponseHash) : null,
      value.status === "synced" ? iso(input.now) : null, iso(input.now), uuid(input.syncId)]);
    return result.rows[0] ? { status: "updated" as const,
      sync: map(result.rows[0], this.session.context.tenantId) }
      : { status: "conflict" as const };
  }
}

function map(row: Row, tenantId: string): EnterpriseMarketingCrmSyncRecord {
  if (required(row.tenant_id) !== tenantId || required(row.provider) !== "salesforce")
    throw invalid();
  const status = required(row.status);
  if (!["pending", "synced", "failed"].includes(status)) throw invalid();
  return { id: uuid(required(row.id)), tenantId,
    campaignId: uuid(required(row.campaign_id)), outcomeId: uuid(required(row.outcome_id)),
    provider: "salesforce", status: status as EnterpriseMarketingCrmSyncRecord["status"],
    externalRecordKey: externalKey(row.external_record_key),
    objectApiName: apiName(row.object_api_name), payloadHash: hash(row.payload_hash),
    providerFingerprint: hash(row.provider_fingerprint), requestHash: hash(row.request_hash),
    idempotencyKey: key(row.idempotency_key), outboxEventId: uuid(required(row.outbox_event_id)),
    ...(present(row.provider_record_id) ? { providerRecordId: recordId(row.provider_record_id) } : {}),
    ...(present(row.provider_record_url) ? { providerRecordUrl: webUrl(row.provider_record_url) } : {}),
    ...(present(row.provider_response_hash) ?
      { providerResponseHash: hash(row.provider_response_hash) } : {}),
    attempts: nonnegative(row.attempts), ...(present(row.last_error_code)
      ? { lastErrorCode: code(row.last_error_code) } : {}),
    createdBy: actor(row.created_by), createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), ...(present(row.synced_at)
      ? { syncedAt: iso(row.synced_at) } : {}), version: integer(row.version, 1) };
}
function required(value: unknown) { if (typeof value !== "string" || !value) throw invalid();
  return value; }
function present(value: unknown) { return value !== null && value !== undefined; }
function uuid(value: unknown) { const text = required(value); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw invalid(); return text; }
function hash(value: unknown) { const text = required(value); if (!/^[a-f0-9]{64}$/.test(text)) throw invalid(); return text; }
function externalKey(value: unknown) { const text = required(value); if (!/^wujie_[a-f0-9]{48}$/.test(text)) throw invalid(); return text; }
function apiName(value: unknown) { const text = required(value); if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(text)) throw invalid(); return text; }
function recordId(value: unknown) { const text = required(value); if (!/^[A-Za-z0-9]{15,18}$/.test(text)) throw invalid(); return text; }
function actor(value: unknown) { const text = required(value); if (!/^user_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw invalid(); return text; }
function key(value: unknown) { const text = required(value); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text)) throw invalid(); return text; }
function code(value: unknown) { const text = required(value); if (!/^[a-z][a-z0-9_]{1,63}$/.test(text)) throw invalid(); return text; }
function nonnegative(value: unknown) { return integer(value, 0); }
function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) { const number = Number(value); if (!Number.isSafeInteger(number) || number < minimum || number > maximum) throw invalid(); return number; }
function iso(value: unknown) { const text = value instanceof Date ? value.toISOString() : required(value); if (!Number.isFinite(Date.parse(text))) throw invalid(); return new Date(text).toISOString(); }
function webUrl(value: unknown) { const text = required(value); try { const url = new URL(text); if (url.protocol !== "https:" || url.username || url.password || text.length > 2048) throw invalid(); return url.toString(); } catch { throw invalid(); } }
function invalid() { return new Error("Invalid enterprise marketing CRM sync row"); }
