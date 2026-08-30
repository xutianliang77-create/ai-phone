import type {
  EnterpriseLeadDirectoryItemDto,
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
} from "@translation/contracts";
import type { EnterpriseContactDirectoryPosition } from
  "../../modules/enterprise/enterprise-contact-directory.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

interface LeadRow extends Record<string, unknown> {
  tenant_id: unknown; id: unknown; external_id: unknown; phone_hint: unknown;
  country_code: unknown; language: unknown; status: unknown; updated_at: unknown;
  campaign_count: unknown; consent_state: unknown; suppression_scope: unknown;
  suppression_created_at: unknown; outcome_id: unknown;
  outcome_campaign_id: unknown; disposition: unknown; intent_level: unknown;
  outcome_created_at: unknown; crm_provider: unknown; crm_status: unknown;
  crm_updated_at: unknown;
}

export class EnterpriseLeadDirectoryPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async list(input: { limit: number; before?: EnterpriseContactDirectoryPosition;
    evaluatedAt: string }) {
    const result = await this.session.query<LeadRow>(`
      ${leadProjection("$4")}
      WHERE lead.tenant_id = $1
        AND ($2::timestamptz IS NULL OR
          (lead.updated_at, lead.id) < ($2::timestamptz, $3::uuid))
      ORDER BY lead.updated_at DESC, lead.id DESC
      LIMIT $5
    `, [input.before?.updatedAt ?? null, input.before?.id ?? null,
      iso(input.evaluatedAt), input.limit + 1]);
    const page = result.rows.slice(0, input.limit).map((row) =>
      mapLead(row, this.session.context.tenantId, input.evaluatedAt));
    const last = page.at(-1);
    return {
      leads: page,
      ...(result.rows.length > input.limit && last
        ? { nextPosition: { updatedAt: last.updatedAt, id: last.id } }
        : {}),
    };
  }

  async find(leadId: string, evaluatedAt: string) {
    const result = await this.session.query<LeadRow>(`
      ${leadProjection("$3")}
      WHERE lead.tenant_id = $1 AND lead.id = $2
      LIMIT 1
    `, [uuid(leadId), iso(evaluatedAt)]);
    return result.rows[0]
      ? mapLead(result.rows[0], this.session.context.tenantId, evaluatedAt)
      : null;
  }
}

function leadProjection(evaluatedAt: string) {
  return `SELECT lead.tenant_id, lead.id, lead.external_id, lead.phone_hint,
      lead.country_code, lead.language, lead.status, lead.updated_at,
      COALESCE(campaigns.campaign_count, 0) AS campaign_count,
      CASE
        WHEN lead.status <> 'active' THEN 'lead_inactive'
        WHEN eligible.id IS NOT NULL THEN 'eligible'
        WHEN latest_consent.revoked_at IS NOT NULL THEN 'consent_revoked'
        WHEN latest_consent.granted_at > ${evaluatedAt}::timestamptz
          THEN 'consent_not_yet_valid'
        WHEN latest_consent.expires_at IS NOT NULL AND
          latest_consent.expires_at <= ${evaluatedAt}::timestamptz
          THEN 'consent_expired'
        ELSE 'consent_required'
      END AS consent_state,
      suppression.scope AS suppression_scope,
      suppression.created_at AS suppression_created_at,
      outcome.id AS outcome_id, outcome.campaign_id AS outcome_campaign_id,
      outcome.disposition, outcome.intent_level,
      outcome.created_at AS outcome_created_at,
      crm.provider AS crm_provider, crm.status AS crm_status,
      crm.updated_at AS crm_updated_at
    FROM enterprise.marketing_leads lead
    LEFT JOIN LATERAL (
      SELECT count(*)::bigint AS campaign_count
      FROM enterprise.marketing_campaign_leads link
      WHERE link.tenant_id = lead.tenant_id AND link.lead_id = lead.id
        AND link.status = 'active'
    ) campaigns ON true
    LEFT JOIN LATERAL (
      SELECT consent.id
      FROM enterprise.contact_consents consent
      JOIN enterprise.marketing_campaign_leads link
        ON link.tenant_id = consent.tenant_id
        AND link.campaign_id = consent.campaign_id
        AND link.lead_id = consent.lead_id
      WHERE consent.tenant_id = lead.tenant_id AND consent.lead_id = lead.id
        AND consent.purpose = 'automated_marketing_call'
        AND consent.granted_at <= ${evaluatedAt}::timestamptz
        AND (consent.expires_at IS NULL OR
          consent.expires_at > ${evaluatedAt}::timestamptz)
        AND consent.revoked_at IS NULL AND link.status = 'active'
      ORDER BY consent.granted_at DESC, consent.id DESC LIMIT 1
    ) eligible ON true
    LEFT JOIN LATERAL (
      SELECT consent.granted_at, consent.expires_at, consent.revoked_at
      FROM enterprise.contact_consents consent
      WHERE consent.tenant_id = lead.tenant_id AND consent.lead_id = lead.id
        AND consent.campaign_id IS NOT NULL
        AND consent.purpose = 'automated_marketing_call'
      ORDER BY consent.created_at DESC NULLS LAST, consent.granted_at DESC,
        consent.id DESC LIMIT 1
    ) latest_consent ON true
    LEFT JOIN LATERAL (
      SELECT item.scope, item.created_at
      FROM enterprise.suppression_entries item
      WHERE item.tenant_id = lead.tenant_id
        AND (item.lead_id = lead.id OR item.phone_hash = lead.phone_hash)
        AND item.scope IN ('tenant', 'global')
      ORDER BY (item.scope = 'global') DESC, item.created_at DESC, item.id DESC
      LIMIT 1
    ) suppression ON true
    LEFT JOIN LATERAL (
      SELECT item.id, item.campaign_id, item.disposition, item.intent_level,
        item.created_at
      FROM enterprise.marketing_outcomes item
      WHERE item.tenant_id = lead.tenant_id AND item.lead_id = lead.id
        AND item.evidence_status = 'verified'
      ORDER BY item.created_at DESC, item.id DESC LIMIT 1
    ) outcome ON true
    LEFT JOIN LATERAL (
      SELECT sync.provider, sync.status, sync.updated_at
      FROM enterprise.marketing_crm_syncs sync
      JOIN enterprise.marketing_outcomes crm_outcome
        ON crm_outcome.tenant_id = sync.tenant_id
        AND crm_outcome.id = sync.outcome_id
      WHERE sync.tenant_id = lead.tenant_id AND crm_outcome.lead_id = lead.id
        AND crm_outcome.evidence_status = 'verified'
      ORDER BY sync.updated_at DESC, sync.id DESC LIMIT 1
    ) crm ON true`;
}

function mapLead(row: LeadRow, tenantId: string,
  evaluatedAt: string): EnterpriseLeadDirectoryItemDto {
  if (uuid(row.tenant_id) !== tenantId) throw invalid();
  const state = oneOf(row.consent_state, ["eligible", "consent_required",
    "consent_not_yet_valid", "consent_expired", "consent_revoked",
    "lead_inactive"] as const);
  const suppression = nullableText(row.suppression_scope) === null
    ? clearSuppression(row)
    : { status: "suppressed" as const,
        scope: oneOf(row.suppression_scope, ["tenant", "global"] as const),
        createdAt: iso(row.suppression_created_at) };
  const outcomeId = nullableText(row.outcome_id);
  const crmProvider = nullableText(row.crm_provider);
  return {
    id: uuid(row.id),
    ...(nullableText(row.phone_hint) ? { phoneHint: maskPhone(row.phone_hint) } : {}),
    ...(nullableText(row.external_id)
      ? { externalIdHint: maskExternalId(row.external_id) } : {}),
    countryCode: pattern(row.country_code, /^[A-Z]{2}$/),
    ...(nullableText(row.language)
      ? { language: pattern(row.language,
          /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/) } : {}),
    status: oneOf(row.status, ["active", "inactive"] as const),
    campaignCount: nonnegative(row.campaign_count),
    consentEligibility: state === "eligible"
      ? { status: "eligible", evaluatedAt: iso(evaluatedAt) }
      : { status: "blocked", evaluatedAt: iso(evaluatedAt), reasonCode: state },
    suppression,
    ...(outcomeId ? { latestVerifiedOutcome: {
      id: uuid(outcomeId), campaignId: uuid(row.outcome_campaign_id),
      disposition: oneOf(row.disposition, dispositions),
      intentLevel: oneOf(row.intent_level, intents),
      createdAt: iso(row.outcome_created_at),
    } } : assertAbsentOutcome(row)),
    ...(crmProvider ? { crmStatus: {
      provider: oneOf(crmProvider, ["salesforce"] as const),
      status: oneOf(row.crm_status, ["pending", "synced", "failed"] as const),
      updatedAt: iso(row.crm_updated_at),
    } } : assertAbsentCrm(row)),
    updatedAt: iso(row.updated_at),
  };
}

const dispositions = ["no_interest", "potential_lead", "appointment_requested",
  "follow_up_required", "do_not_contact", "invalid_number", "call_failed",
  "completed_unclassified"] as const satisfies readonly EnterpriseMarketingDisposition[];
const intents = ["none", "low", "medium", "high", "unknown"] as const satisfies
  readonly EnterpriseMarketingIntentLevel[];
function assertAbsentOutcome(row: LeadRow) { if ([row.outcome_campaign_id, row.disposition,
  row.intent_level, row.outcome_created_at].some(present)) throw invalid(); return {}; }
function assertAbsentCrm(row: LeadRow) { if ([row.crm_status, row.crm_updated_at]
  .some(present)) throw invalid(); return {}; }
function clearSuppression(row: LeadRow) { if (present(row.suppression_created_at))
  throw invalid(); return { status: "clear" as const }; }
function maskPhone(value: unknown) { const text = pattern(value, /^\+[0-9*]{5,20}$/);
  const body = text.slice(1); return `+${body[0]}${"*".repeat(Math.max(3,
    body.length - 5))}${body.slice(-4)}`; }
function maskExternalId(value: unknown) { const text = bounded(value, 200);
  return text.length <= 4 ? `${text[0]}***` :
    `${text.slice(0, 2)}***${text.slice(-2)}`; }
function nullableText(value: unknown) { return value === null || value === undefined
  ? null : bounded(value, 4_000); }
function bounded(value: unknown, max: number) { if (typeof value !== "string" ||
  value !== value.trim() || value.length < 1 || value.length > max) throw invalid();
  return value; }
function pattern(value: unknown, regex: RegExp) { const text = bounded(value, 200);
  if (!regex.test(text)) throw invalid(); return text; }
function uuid(value: unknown) { return pattern(value,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); }
function iso(value: unknown) { const text = value instanceof Date ? value.toISOString()
  : bounded(value, 64); if (!Number.isFinite(Date.parse(text))) throw invalid();
  return new Date(text).toISOString(); }
function nonnegative(value: unknown) { const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid(); return number; }
function oneOf<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  const text = bounded(value, 100); if (!values.includes(text as T[number])) throw invalid();
  return text as T[number]; }
function present(value: unknown) { return value !== null && value !== undefined; }
function invalid() { return new Error("Invalid enterprise lead directory row"); }
