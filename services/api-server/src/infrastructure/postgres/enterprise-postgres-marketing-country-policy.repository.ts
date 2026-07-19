import {
  prepareEnterpriseCountryPolicy,
  resolveEnterpriseCountryPolicyReadiness,
  type EnterpriseCountryPolicyRecord,
} from "../../modules/enterprise/enterprise-marketing-country-policy.js";
import { enterprisePostgresAccountSubjectId,
  enterprisePostgresActorSubjectId } from "./enterprise-postgres-subject-id.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingCountryPolicyPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async publish(input: Omit<EnterpriseCountryPolicyRecord,
    "tenantId" | "version"> & { idempotencyKey: string }) {
    await this.lock(`publish:${eventKey(input.idempotencyKey)}`);
    const replay = await this.findByCreationKey(input.idempotencyKey, true);
    if (replay) return replay.creation_request_hash === hash(input.creationRequestHash)
      ? { status: "replayed" as const, policy: mapPolicy(replay) }
      : { status: "idempotency_conflict" as const };
    await this.lock(`country:${country(input.countryCode)}`);
    if (await this.findByVersion(input.countryCode, input.policyVersion, true)) {
      return { status: "policy_version_conflict" as const };
    }
    if (await this.overlaps(input.countryCode, input.effectiveFrom, input.expiresAt)) {
      return { status: "effective_window_conflict" as const };
    }
    const result = await this.session.query<CountryPolicyRow>(`
      INSERT INTO enterprise.marketing_country_policy_versions(
        tenant_id, id, country_code, policy_version, calling_windows,
        max_attempts, frequency_window_hours, min_retry_interval_minutes,
        disclosure_version, brand_disclosure, ai_identity_disclosure,
        marketing_purpose_disclosure, voicemail_mode, voicemail_version,
        voicemail_message, compliance_reference, content_hash, effective_from,
        expires_at, published_by, published_at, creation_key,
        creation_request_hash, version
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 1)
      RETURNING *
    `, [uuid(input.id), country(input.countryCode), eventKey(input.policyVersion),
      JSON.stringify(input.callingWindows), input.maxAttempts,
      input.frequencyWindowHours, input.minRetryIntervalMinutes,
      eventKey(input.disclosure.version), text(input.disclosure.brand, 500),
      text(input.disclosure.aiIdentity, 500),
      text(input.disclosure.marketingPurpose, 500), input.voicemail.mode,
      input.voicemail.version ?? null, input.voicemail.message ?? null,
      text(input.complianceReference, 500), hash(input.contentHash),
      iso(input.effectiveFrom), iso(input.expiresAt),
      enterprisePostgresActorSubjectId(input.publishedBy), iso(input.publishedAt),
      eventKey(input.idempotencyKey), hash(input.creationRequestHash)]);
    if (!result.rows[0]) throw new Error("Country policy insert failed");
    return { status: "created" as const, policy: mapPolicy(result.rows[0]) };
  }

  async list() {
    const result = await this.session.query<CountryPolicyRow>(`
      SELECT * FROM enterprise.marketing_country_policy_versions
      WHERE tenant_id = $1
      ORDER BY country_code, effective_from DESC, id
      LIMIT 500
    `);
    return result.rows.map(mapPolicy);
  }

  async resolveCampaign(campaignId: string, evaluatedAt: string) {
    const campaign = await this.session.query<CampaignPolicyScopeRow>(`
      SELECT country_codes, schedule FROM enterprise.marketing_campaigns
      WHERE tenant_id = $1 AND id = $2
    `, [uuid(campaignId)]);
    const row = campaign.rows[0];
    if (!row) return { status: "not_found" as const };
    const targetAt = scheduleStart(row.schedule) ?? iso(evaluatedAt);
    const result = await this.session.query<CountryPolicyRow>(`
      SELECT * FROM enterprise.marketing_country_policy_versions
      WHERE tenant_id = $1 AND country_code = ANY($2::text[])
      ORDER BY country_code, effective_from DESC, id
    `, [row.country_codes.map(country)]);
    return { ...resolveEnterpriseCountryPolicyReadiness({
      policies: result.rows.map(mapPolicy), countryCodes: row.country_codes.map(country),
      targetAt,
    }), targetAt };
  }

  private async findByCreationKey(value: string, lock: boolean) {
    const result = await this.session.query<CountryPolicyRow>(`
      SELECT * FROM enterprise.marketing_country_policy_versions
      WHERE tenant_id = $1 AND published_by = $2 AND creation_key = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [enterprisePostgresActorSubjectId(this.session.context.actorUserId),
      eventKey(value)]);
    return result.rows[0] ?? null;
  }
  private async findByVersion(countryCode: string, policyVersion: string,
    lock: boolean) {
    const result = await this.session.query<CountryPolicyRow>(`
      SELECT * FROM enterprise.marketing_country_policy_versions
      WHERE tenant_id = $1 AND country_code = $2 AND policy_version = $3
      ${lock ? "FOR UPDATE" : ""}
    `, [country(countryCode), eventKey(policyVersion)]);
    return result.rows[0] ?? null;
  }
  private async overlaps(countryCode: string, effectiveFrom: string,
    expiresAt: string) {
    const result = await this.session.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM enterprise.marketing_country_policy_versions
        WHERE tenant_id = $1 AND country_code = $2
          AND effective_from < $4::timestamptz AND expires_at > $3::timestamptz
      ) AS present
    `, [country(countryCode), iso(effectiveFrom), iso(expiresAt)]);
    return result.rows[0]?.present === true;
  }
  private async lock(scope: string) {
    await this.session.query(`
      SELECT pg_advisory_xact_lock(hashtextextended(
        $1::text || ':marketing-country-policy:' || $2, 0))
      FROM (SELECT $1::text AS tenant_id) AS policy_scope
      WHERE tenant_id = $1
    `, [scope]);
  }
}

interface CountryPolicyRow extends Record<string, unknown> {
  id: string; tenant_id: string; country_code: string; policy_version: string;
  calling_windows: unknown; max_attempts: number | string;
  frequency_window_hours: number | string; min_retry_interval_minutes: number | string;
  disclosure_version: string; brand_disclosure: string;
  ai_identity_disclosure: string; marketing_purpose_disclosure: string;
  voicemail_mode: string; voicemail_version: string | null;
  voicemail_message: string | null; compliance_reference: string;
  content_hash: string; effective_from: string | Date; expires_at: string | Date;
  published_by: string; published_at: string | Date; creation_request_hash: string;
  version: number | string;
}
interface CampaignPolicyScopeRow extends Record<string, unknown> {
  country_codes: string[]; schedule: unknown;
}
function mapPolicy(row: CountryPolicyRow): EnterpriseCountryPolicyRecord {
  const publishedAt = iso(row.published_at);
  const voicemail = voicemailValue(row);
  const prepared = prepareEnterpriseCountryPolicy({
    countryCode: country(row.country_code), policyVersion: eventKey(row.policy_version),
    callingWindows: windows(row.calling_windows), maxAttempts: positive(row.max_attempts),
    frequencyWindowHours: positive(row.frequency_window_hours),
    minRetryIntervalMinutes: positive(row.min_retry_interval_minutes),
    disclosure: { version: eventKey(row.disclosure_version),
      brand: text(row.brand_disclosure, 500),
      aiIdentity: text(row.ai_identity_disclosure, 500),
      marketingPurpose: text(row.marketing_purpose_disclosure, 500) },
    voicemail, complianceReference: text(row.compliance_reference, 500),
    effectiveFrom: iso(row.effective_from), expiresAt: iso(row.expires_at),
  }, publishedAt);
  return { id: uuid(row.id), tenantId: uuid(row.tenant_id), ...prepared,
    contentHash: hash(row.content_hash),
    publishedBy: enterprisePostgresAccountSubjectId(row.published_by), publishedAt,
    creationRequestHash: hash(row.creation_request_hash), version: positive(row.version) };
}
function voicemailValue(row: CountryPolicyRow) {
  if (row.voicemail_mode === "compliant_message") return {
    mode: row.voicemail_mode, version: eventKey(row.voicemail_version),
    message: text(row.voicemail_message, 1_000) } as const;
  if ((row.voicemail_mode === "disabled" || row.voicemail_mode === "human_only") &&
    row.voicemail_version === null && row.voicemail_message === null) {
    return { mode: row.voicemail_mode } as const;
  }
  throw new Error("Invalid country policy voicemail row");
}
function windows(value: unknown) { if (!Array.isArray(value)) throw new Error(
  "Invalid country policy windows"); return value as Array<{ weekday: number;
    startMinute: number; endMinute: number }>; }
function scheduleStart(value: unknown) { if (!value || typeof value !== "object" ||
  Array.isArray(value)) return null; const start = (value as Record<string, unknown>).startAt;
  return start === undefined ? null : iso(start); }
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid country policy UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid country policy hash"); return value; }
function country(value: unknown) { if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) throw new Error("Invalid country policy country"); return value; }
function eventKey(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error("Invalid country policy key"); return value; }
function text(value: unknown, max: number) { if (typeof value !== "string" || value !== value.trim() || Buffer.byteLength(value) < 1 || Buffer.byteLength(value) > max) throw new Error("Invalid country policy text"); return value; }
function positive(value: unknown) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid country policy number"); return number; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || new Date(result).toISOString() !== result) throw new Error("Invalid country policy timestamp"); return result; }
