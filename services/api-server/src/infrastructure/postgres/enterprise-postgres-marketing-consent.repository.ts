import type { EnterpriseMarketingConsentRecord } from
  "../../modules/enterprise/enterprise-marketing-consent.js";
import { enterpriseMarketingConsentPurpose } from
  "../../modules/enterprise/enterprise-marketing-consent.js";
import { enterprisePostgresAccountSubjectId } from
  "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingConsentPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async create(input: {
    id: string; campaignId: string; leadId: string;
    collectionChannel: EnterpriseMarketingConsentRecord["collectionChannel"];
    evidence: EnterpriseMarketingConsentRecord["evidence"];
    sourceReference: string; grantedAt: string; expiresAt?: string;
    consentStatementVersion: string; idempotencyKey: string;
    requestHash: string; createdAt: string;
  }) {
    await this.lock(input.idempotencyKey);
    const replay = await this.findByCreationKey(input.idempotencyKey, true);
    if (replay) return replay.creation_request_hash === hash(input.requestHash)
      ? { status: "replayed" as const, consent: mapConsent(replay) }
      : { status: "idempotency_conflict" as const };
    const evidence = await this.session.query<ConsentRow>(`
      SELECT * FROM enterprise.contact_consents
      WHERE tenant_id = $1 AND evidence_object_id = $2
      FOR UPDATE
    `, [uuid(input.evidence.objectId)]);
    if (evidence.rows[0]) return { status: "evidence_conflict" as const };
    const scope = await this.scope(input.campaignId, input.leadId, true);
    if (!scope) return { status: "not_found" as const };
    if (scope.campaign_status !== "draft" ||
      scope.approval_status !== "not_submitted") {
      return { status: "campaign_not_editable" as const };
    }
    const result = await this.session.query<ConsentRow>(`
      INSERT INTO enterprise.contact_consents(
        tenant_id, id, campaign_id, lead_id, purpose, channel,
        evidence_object_id, evidence_sha256, evidence_size_bytes,
        evidence_content_type, source_reference, granted_at, expires_at,
        revoked_at, policy_version, created_by, created_at, updated_at, version,
        creation_key, creation_request_hash, revoked_by, revocation_reason,
        revocation_key, revocation_request_hash
      ) VALUES ($1, $2, $3, $4, 'automated_marketing_call', $5, $6, $7, $8,
        $9, $10, $11, $12, NULL, $13, $14, $15, $15, 1, $16, $17,
        NULL, NULL, NULL, NULL)
      RETURNING *
    `, [uuid(input.id), uuid(input.campaignId), uuid(input.leadId),
      input.collectionChannel, uuid(input.evidence.objectId),
      hash(input.evidence.sha256), input.evidence.sizeBytes,
      contentType(input.evidence.contentType), bounded(input.sourceReference, 200),
      iso(input.grantedAt), input.expiresAt ? iso(input.expiresAt) : null,
      statementVersion(input.consentStatementVersion),
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      iso(input.createdAt), eventKey(input.idempotencyKey), hash(input.requestHash)]);
    if (!result.rows[0]) throw new Error("Marketing consent insert failed");
    return { status: "created" as const, consent: mapConsent(result.rows[0]) };
  }

  async list(campaignId: string, leadId: string) {
    if (!await this.scope(campaignId, leadId)) return null;
    const result = await this.session.query<ConsentRow>(`
      SELECT * FROM enterprise.contact_consents
      WHERE tenant_id = $1 AND campaign_id = $2 AND lead_id = $3
        AND purpose = 'automated_marketing_call'
      ORDER BY granted_at DESC, created_at DESC, id
      LIMIT 200
    `, [uuid(campaignId), uuid(leadId)]);
    return result.rows.map(mapConsent);
  }

  async resolve(campaignId: string, leadId: string, evaluatedAt: string) {
    if (!await this.scope(campaignId, leadId)) return { status: "not_found" as const };
    const values = [uuid(campaignId), uuid(leadId), iso(evaluatedAt)];
    const valid = await this.session.query<ConsentRow>(`
      SELECT * FROM enterprise.contact_consents
      WHERE tenant_id = $1 AND campaign_id = $2 AND lead_id = $3
        AND purpose = 'automated_marketing_call' AND granted_at <= $4
        AND (expires_at IS NULL OR expires_at > $4) AND revoked_at IS NULL
      ORDER BY granted_at DESC, created_at DESC, id
      LIMIT 1
    `, values);
    if (valid.rows[0]) return { status: "eligible" as const,
      consent: mapConsent(valid.rows[0]) };
    const latest = await this.session.query<ConsentRow>(`
      SELECT * FROM enterprise.contact_consents
      WHERE tenant_id = $1 AND campaign_id = $2 AND lead_id = $3
        AND purpose = 'automated_marketing_call'
      ORDER BY granted_at DESC, created_at DESC, id
      LIMIT 1
    `, values.slice(0, 2));
    return { status: "blocked" as const,
      ...(latest.rows[0] ? { latest: mapConsent(latest.rows[0]) } : {}) };
  }

  async revoke(input: { campaignId: string; leadId: string; consentId: string;
    expectedVersion: number; reason: string; idempotencyKey: string;
    requestHash: string; occurredAt: string }) {
    await this.lock(input.idempotencyKey);
    const current = await this.find(input, true);
    if (!current) return { status: "not_found" as const };
    if (current.revoked_at) return current.revocation_key === input.idempotencyKey &&
      current.revocation_request_hash === input.requestHash &&
      current.revoked_by === this.session.context.actorUserId
      ? { status: "replayed" as const, consent: mapConsent(current),
          cancelledTaskCount: 0 }
      : { status: "idempotency_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "conflict" as const };
    }
    const cancelledTaskCount = await this.tasksLosingConsent(input);
    const occurredAt = nextIso(input.occurredAt, current.updated_at);
    const result = await this.session.query<ConsentRow>(`
      UPDATE enterprise.contact_consents
      SET revoked_at = $5, revoked_by = $6, revocation_reason = $7,
        revocation_key = $8, revocation_request_hash = $9,
        updated_at = $5, version = version + 1
      WHERE tenant_id = $1 AND campaign_id = $2 AND lead_id = $3 AND id = $4
        AND revoked_at IS NULL AND version = $10
      RETURNING *
    `, [uuid(input.campaignId), uuid(input.leadId), uuid(input.consentId),
      occurredAt, enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      bounded(input.reason, 500), eventKey(input.idempotencyKey),
      hash(input.requestHash), input.expectedVersion]);
    if (!result.rows[0]) return { status: "conflict" as const };
    return { status: "revoked" as const, consent: mapConsent(result.rows[0]),
      cancelledTaskCount };
  }

  private async tasksLosingConsent(input: { campaignId: string; leadId: string;
    consentId: string }) {
    const result = await this.session.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM enterprise.marketing_call_tasks task
      WHERE task.tenant_id = $1 AND task.campaign_id = $2 AND task.lead_id = $3
        AND task.status IN ('pending', 'scheduled', 'retry')
        AND NOT EXISTS (
          SELECT 1 FROM enterprise.contact_consents alternate
          WHERE alternate.tenant_id = task.tenant_id
            AND alternate.campaign_id = task.campaign_id
            AND alternate.lead_id = task.lead_id AND alternate.id <> $4
            AND alternate.purpose = 'automated_marketing_call'
            AND alternate.granted_at <= task.scheduled_at
            AND (alternate.expires_at IS NULL OR alternate.expires_at > task.scheduled_at)
            AND alternate.revoked_at IS NULL
        )
    `, [uuid(input.campaignId), uuid(input.leadId), uuid(input.consentId)]);
    return Number(result.rows[0]?.count ?? 0);
  }

  private async scope(campaignId: string, leadId: string, lock = false) {
    const result = await this.session.query<ScopeRow>(`
      SELECT campaign.status AS campaign_status,
        campaign.approval_status, link.status AS link_status, lead.status AS lead_status
      FROM enterprise.marketing_campaigns campaign
      JOIN enterprise.marketing_campaign_leads link
        ON link.tenant_id = campaign.tenant_id AND link.campaign_id = campaign.id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
      WHERE campaign.tenant_id = $1 AND campaign.id = $2 AND link.lead_id = $3
        AND link.status = 'active' AND lead.status = 'active'
      ${lock ? "FOR UPDATE OF campaign, link, lead" : ""}
    `, [uuid(campaignId), uuid(leadId)]);
    return result.rows[0] ?? null;
  }

  private async find(input: { campaignId: string; leadId: string; consentId: string },
    lock = false) {
    const result = await this.session.query<ConsentRow>(`
      SELECT * FROM enterprise.contact_consents
      WHERE tenant_id = $1 AND campaign_id = $2 AND lead_id = $3 AND id = $4
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(input.campaignId), uuid(input.leadId), uuid(input.consentId)]);
    return result.rows[0] ?? null;
  }

  private async findByCreationKey(key: string, lock = false) {
    const result = await this.session.query<ConsentRow>(`
      SELECT * FROM enterprise.contact_consents
      WHERE tenant_id = $1 AND created_by = $2 AND creation_key = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [enterprisePostgresAccountSubjectId(this.session.context.actorUserId), eventKey(key)]);
    return result.rows[0] ?? null;
  }

  private async lock(key: string) {
    await this.session.query(`
      SELECT pg_advisory_xact_lock(hashtextextended(
        $1::text || ':' || $2 || ':' || $3, 0))
      FROM (SELECT $1::text AS tenant_id) AS consent_scope
      WHERE tenant_id = $1
    `, [enterprisePostgresAccountSubjectId(this.session.context.actorUserId), eventKey(key)]);
  }
}

interface ScopeRow extends Record<string, unknown> { campaign_status: string;
  approval_status: string; link_status: string; lead_status: string }
interface ConsentRow extends Record<string, unknown> { id: string; tenant_id: string;
  campaign_id: string; lead_id: string; purpose: string; channel: string;
  evidence_object_id: string; evidence_sha256: string; evidence_size_bytes: string | number;
  evidence_content_type: string; source_reference: string; granted_at: string | Date;
  expires_at: string | Date | null; revoked_at: string | Date | null; policy_version: string;
  created_by: string; created_at: string | Date; updated_at: string | Date;
  version: string | number; creation_key: string; creation_request_hash: string;
  revoked_by: string | null; revocation_reason: string | null;
  revocation_key: string | null; revocation_request_hash: string | null }

function mapConsent(row: ConsentRow): EnterpriseMarketingConsentRecord {
  if (row.purpose !== enterpriseMarketingConsentPurpose ||
    !channels.includes(row.channel as typeof channels[number])) {
    throw new Error("Invalid marketing consent row");
  }
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id),
    campaignId: uuid(row.campaign_id), leadId: uuid(row.lead_id),
    purpose: enterpriseMarketingConsentPurpose,
    collectionChannel: row.channel as EnterpriseMarketingConsentRecord["collectionChannel"],
    evidence: { objectId: uuid(row.evidence_object_id), sha256: hash(row.evidence_sha256),
      sizeBytes: positiveInteger(row.evidence_size_bytes),
      contentType: contentType(row.evidence_content_type) },
    sourceReference: bounded(row.source_reference, 200),
    grantedAt: iso(row.granted_at), ...(row.expires_at ? { expiresAt: iso(row.expires_at) } : {}),
    consentStatementVersion: statementVersion(row.policy_version),
    ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
    ...(row.revocation_reason ? { revocationReason: bounded(row.revocation_reason, 500) } : {}),
    createdBy: enterprisePostgresAccountSubjectId(row.created_by),
    createdAt: iso(row.created_at), version: positiveInteger(row.version) };
}
const channels = ["web_form", "signed_document", "recorded_call", "crm_attestation"] as const;
const contentTypes = new Set(["application/pdf", "image/jpeg", "image/png", "audio/mpeg",
  "audio/wav", "audio/x-wav", "application/json", "text/plain"]);
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid consent UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid consent hash"); return value; }
function eventKey(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error("Invalid consent key"); return value; }
function statementVersion(value: unknown) { return eventKey(value); }
function bounded(value: unknown, max: number) { if (typeof value !== "string" || value !== value.trim() || value.length < 1 || Buffer.byteLength(value) > max) throw new Error("Invalid consent text"); return value; }
function contentType(value: unknown) { if (typeof value !== "string" || !contentTypes.has(value)) throw new Error("Invalid evidence content type"); return value; }
function positiveInteger(value: unknown) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid consent number"); return number; }
function iso(value: unknown) { const text = value instanceof Date ? value.toISOString() : value; if (typeof text !== "string" || new Date(text).toISOString() !== text) throw new Error("Invalid consent timestamp"); return text; }
function nextIso(value: unknown, after: string | Date) { const candidate = iso(value); const prior = iso(after); return candidate > prior ? candidate : new Date(Date.parse(prior) + 1).toISOString(); }
