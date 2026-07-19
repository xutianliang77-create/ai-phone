import type { EnterpriseMarketingSuppressionRecord } from
  "../../modules/enterprise/enterprise-marketing-suppression.js";
import { enterprisePostgresActorSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingSuppressionPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async create(input: {
    id: string; campaignId: string; leadId: string; scope: "tenant";
    source: EnterpriseMarketingSuppressionRecord["source"];
    reason: string; sourceReference: string; idempotencyKey: string;
    requestHash: string; createdAt: string;
  }) {
    await this.lock(input.idempotencyKey);
    const replay = await this.findByCreationKey(input.idempotencyKey, true);
    if (replay) return replay.creation_request_hash === hash(input.requestHash)
      ? { status: "replayed" as const, suppression: mapSuppression(replay) }
      : { status: "idempotency_conflict" as const };
    const lead = await this.scope(input.campaignId, input.leadId, true);
    if (!lead) return { status: "not_found" as const };
    await this.lockPhone(lead.phone_hash);
    const existing = await this.findByPhone(lead.phone_hash, input.scope, true);
    if (existing) return { status: "already_suppressed" as const,
      suppression: mapSuppression(existing) };
    const result = await this.session.query<SuppressionRow>(`
      INSERT INTO enterprise.suppression_entries(
        tenant_id, id, phone_hash, scope, reason, source, created_at,
        origin_campaign_id, lead_id, source_reference, created_by, updated_at,
        version, creation_key, creation_request_hash, cancelled_task_count
      ) VALUES ($1, $2, $3, 'tenant', $4, $5, $6, $7, $8, $9, $10, $6,
        1, $11, $12, 0)
      RETURNING *, $13::text AS phone_hint
    `, [uuid(input.id), hash(lead.phone_hash), text(input.reason, 500),
      source(input.source), iso(input.createdAt), uuid(input.campaignId),
      uuid(input.leadId), text(input.sourceReference, 200),
      enterprisePostgresActorSubjectId(this.session.context.actorUserId),
      eventKey(input.idempotencyKey), hash(input.requestHash), lead.phone_hint]);
    if (!result.rows[0]) throw new Error("Marketing suppression insert failed");
    return { status: "created" as const,
      suppression: mapSuppression(result.rows[0]) };
  }

  async list(campaignId: string, leadId: string) {
    const lead = await this.scope(campaignId, leadId);
    if (!lead) return null;
    const result = await this.session.query<SuppressionRow>(`
      SELECT suppression.*, $3::text AS phone_hint
      FROM enterprise.suppression_entries suppression
      WHERE suppression.tenant_id = $1 AND suppression.phone_hash = $2
        AND suppression.scope IN ('tenant', 'global')
      ORDER BY suppression.created_at DESC, suppression.id
      LIMIT 100
    `, [hash(lead.phone_hash), lead.phone_hint]);
    return result.rows.map(mapSuppression);
  }

  async resolve(campaignId: string, leadId: string) {
    const suppressions = await this.list(campaignId, leadId);
    if (!suppressions) return { status: "not_found" as const };
    const suppression = suppressions.find((entry) => entry.scope === "global") ??
      suppressions[0];
    return suppression ? { status: "blocked" as const, suppression }
      : { status: "eligible" as const };
  }

  private async scope(campaignId: string, leadId: string, lock = false) {
    const result = await this.session.query<LeadScopeRow>(`
      SELECT lead.phone_hash, lead.phone_hint
      FROM enterprise.marketing_campaigns campaign
      JOIN enterprise.marketing_campaign_leads link
        ON link.tenant_id = campaign.tenant_id AND link.campaign_id = campaign.id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
      WHERE campaign.tenant_id = $1 AND campaign.id = $2 AND lead.id = $3
        AND link.status = 'active' AND lead.status = 'active'
      ${lock ? "FOR UPDATE OF campaign, link, lead" : ""}
    `, [uuid(campaignId), uuid(leadId)]);
    return result.rows[0] ?? null;
  }

  private async findByPhone(phoneHash: string, scope: "tenant", lock = false) {
    const result = await this.session.query<SuppressionRow>(`
      SELECT suppression.*, lead.phone_hint
      FROM enterprise.suppression_entries suppression
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = suppression.tenant_id AND lead.id = suppression.lead_id
      WHERE suppression.tenant_id = $1 AND suppression.phone_hash = $2
        AND suppression.scope = $3
      ${lock ? "FOR UPDATE OF suppression" : ""}
    `, [hash(phoneHash), scope]);
    return result.rows[0] ?? null;
  }

  private async findByCreationKey(key: string, lock = false) {
    const result = await this.session.query<SuppressionRow>(`
      SELECT suppression.*, lead.phone_hint
      FROM enterprise.suppression_entries suppression
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = suppression.tenant_id AND lead.id = suppression.lead_id
      WHERE suppression.tenant_id = $1 AND suppression.created_by = $2
        AND suppression.creation_key = $3
      ${lock ? "FOR UPDATE OF suppression" : ""}
    `, [enterprisePostgresActorSubjectId(this.session.context.actorUserId),
      eventKey(key)]);
    return result.rows[0] ?? null;
  }

  private async lock(key: string) {
    await this.session.query(`
      SELECT pg_advisory_xact_lock(hashtextextended(
        $1::text || ':' || $2 || ':' || $3, 0))
      FROM (SELECT $1::text AS tenant_id) AS suppression_scope
      WHERE tenant_id = $1
    `, [enterprisePostgresActorSubjectId(this.session.context.actorUserId),
      eventKey(key)]);
  }

  private async lockPhone(phoneHash: string) {
    await this.session.query(`
      SELECT pg_advisory_xact_lock(hashtextextended(
        $1::text || ':marketing-suppression:' || $2, 0))
      FROM (SELECT $1::text AS tenant_id) AS suppression_phone
      WHERE tenant_id = $1
    `, [hash(phoneHash)]);
  }
}

interface LeadScopeRow extends Record<string, unknown> {
  phone_hash: string; phone_hint: string;
}
interface SuppressionRow extends Record<string, unknown> {
  id: string; tenant_id: string; lead_id: string; phone_hint: string;
  scope: string; source: string; reason: string; source_reference: string;
  created_by: string; created_at: string | Date; cancelled_task_count: number | string;
  version: number | string; creation_request_hash: string;
}
const scopes = ["tenant", "global"] as const;
const sources = ["manual", "contact_request", "consent_withdrawal", "complaint",
  "global_registry"] as const;
function mapSuppression(row: SuppressionRow): EnterpriseMarketingSuppressionRecord {
  if (!scopes.includes(row.scope as typeof scopes[number]) ||
    !sources.includes(row.source as typeof sources[number])) {
    throw new Error("Invalid marketing suppression row");
  }
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), leadId: uuid(row.lead_id),
    phoneHint: phoneHint(row.phone_hint),
    scope: row.scope as EnterpriseMarketingSuppressionRecord["scope"],
    source: row.source as EnterpriseMarketingSuppressionRecord["source"],
    reason: text(row.reason, 500), sourceReference: text(row.source_reference, 200),
    createdBy: enterprisePostgresActorSubjectId(row.created_by),
    createdAt: iso(row.created_at),
    cancelledTaskCount: nonNegativeInteger(row.cancelled_task_count),
    version: positiveInteger(row.version) };
}
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid suppression UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid suppression hash"); return value; }
function eventKey(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error("Invalid suppression key"); return value; }
function text(value: unknown, max: number) { if (typeof value !== "string" || value !== value.trim() || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > max) throw new Error("Invalid suppression text"); return value; }
function source(value: unknown) { if (!sources.slice(0, 4).includes(value as typeof sources[number])) throw new Error("Invalid suppression source"); return value; }
function phoneHint(value: unknown) { if (typeof value !== "string" || !/^\+\*+\d{4}$/.test(value)) throw new Error("Invalid suppression phone hint"); return value; }
function nonNegativeInteger(value: unknown) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid suppression count"); return number; }
function positiveInteger(value: unknown) { const number = nonNegativeInteger(value); if (number < 1) throw new Error("Invalid suppression version"); return number; }
function iso(value: unknown) { const text = value instanceof Date ? value.toISOString() : value; if (typeof text !== "string" || new Date(text).toISOString() !== text) throw new Error("Invalid suppression timestamp"); return text; }
