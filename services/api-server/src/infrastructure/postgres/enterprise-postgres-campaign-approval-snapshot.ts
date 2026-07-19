import type { EnterpriseCampaignValidationIssue } from "@translation/contracts";
import { digest, type EnterpriseCampaignConsentSnapshotItem,
  type EnterpriseCampaignLeadSnapshotItem,
  type EnterpriseCampaignSuppressionSnapshotItem,
  type EnterpriseCampaignValidationSnapshotRecord } from
  "../../modules/enterprise/enterprise-campaign-approval.js";
import type { EnterpriseCampaignRecord } from
  "../../modules/enterprise/enterprise-campaign.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export async function buildEnterpriseCampaignValidationSnapshot(input: {
  session: EnterpriseTenantPostgresSession; campaign: EnterpriseCampaignRecord;
  id: string; validatedBy: string; validatedAt: string;
  creationKey: string; creationRequestHash: string;
}): Promise<EnterpriseCampaignValidationSnapshotRecord> {
  const targetAt = input.campaign.schedule.startAt;
  const campaignSnapshot = { name: input.campaign.name,
    objective: input.campaign.objective, ownerUserId: input.campaign.ownerUserId,
    countryCodes: input.campaign.countryCodes,
    languageCodes: input.campaign.languageCodes, schedule: input.campaign.schedule,
    concurrencyLimit: input.campaign.concurrencyLimit };
  const leads = await loadLeads(input.session, input.campaign.id);
  await lockLeadPhones(input.session, input.campaign.id);
  const policies = targetAt ? await loadPolicies(input.session,
    input.campaign.countryCodes, targetAt) : { active: [], all: [] };
  const consents = targetAt ? await loadConsents(input.session,
    input.campaign.id, targetAt) : [];
  const suppressions = await loadSuppressions(input.session, input.campaign.id);
  const validTimezones = await loadTimezones(input.session, input.campaign.id, leads);
  const issues = issuesFor({ campaign: input.campaign, targetAt, leads,
    activePolicies: policies.active, allPolicies: policies.all, consents,
    suppressions, validTimezones, validatedAt: input.validatedAt });
  const campaignHash = digest(campaignSnapshot);
  const policySetHash = digest(policies.active);
  const leadSetHash = digest(leads); const consentSetHash = digest(consents);
  const suppressionSetHash = digest(suppressions);
  const snapshotHash = digest({ campaignHash, targetAt, policySetHash, leadSetHash,
    consentSetHash, suppressionSetHash });
  return { id: input.id, tenantId: input.campaign.tenantId,
    campaignId: input.campaign.id, sourceCampaignVersion: input.campaign.version,
    status: issues.length ? "blocked" : "ready", ...(targetAt ? { targetAt } : {}),
    campaignSnapshot, campaignHash, policies: policies.active, policySetHash,
    leads, leadSetHash, consents, consentSetHash, suppressions,
    suppressionSetHash, issues, snapshotHash, validatedBy: input.validatedBy,
    validatedAt: input.validatedAt, creationKey: input.creationKey,
    creationRequestHash: input.creationRequestHash, version: 1 };
}

export async function enterpriseCampaignApprovalSnapshotBlock(
  session: EnterpriseTenantPostgresSession,
  campaign: EnterpriseCampaignRecord,
  evaluatedAt: string,
) {
  if (!campaign.approvalSnapshotId) return "approval_snapshot_required" as const;
  const result = await session.query<{ decision: string; status: string;
    snapshot_hash: string }>(`
    SELECT decision.decision, validation.status, validation.snapshot_hash
    FROM enterprise.marketing_campaign_approval_decisions decision
    JOIN enterprise.marketing_campaign_validation_snapshots validation
      ON validation.tenant_id = decision.tenant_id
      AND validation.id = decision.validation_snapshot_id
    WHERE decision.tenant_id = $1 AND decision.id = $2
      AND decision.campaign_id = $3
  `, [uuid(campaign.approvalSnapshotId), uuid(campaign.id)]);
  const row = result.rows[0];
  if (!row || row.decision !== "approved" || row.status !== "ready" ||
    hash(row.snapshot_hash) !== campaign.policyVersion) {
    return "approval_snapshot_required" as const;
  }
  const current = await buildEnterpriseCampaignValidationSnapshot({ session,
    campaign, id: campaign.approvalSnapshotId, validatedBy: campaign.ownerUserId,
    validatedAt: iso(evaluatedAt), creationKey: "schedule-check",
    creationRequestHash: "0".repeat(64) });
  return current.status === "ready" && current.snapshotHash === row.snapshot_hash
    ? null : "approval_snapshot_stale" as const;
}

export async function enterpriseCampaignCountryPolicyBlock(
  session: EnterpriseTenantPostgresSession,
  campaign: EnterpriseCampaignRecord,
) {
  const targetAt = iso(campaign.schedule.startAt); const target = Date.parse(targetAt);
  const result = await session.query<PolicyRow>(`
    SELECT id, country_code, policy_version, content_hash, effective_from, expires_at
    FROM enterprise.marketing_country_policy_versions
    WHERE tenant_id = $1 AND country_code = ANY($2::text[])
    ORDER BY country_code, effective_from DESC, id
  `, [campaign.countryCodes]);
  for (const countryCode of campaign.countryCodes) {
    const versions = result.rows.filter((row) => row.country_code === countryCode);
    if (versions.some((row) => Date.parse(iso(row.effective_from)) <= target &&
      Date.parse(iso(row.expires_at)) > target)) continue;
    if (versions.some((row) => Date.parse(iso(row.effective_from)) > target)) {
      return "country_policy_not_yet_effective" as const;
    }
    return versions.length ? "country_policy_expired" as const
      : "country_policy_missing" as const;
  }
  return null;
}

async function loadLeads(session: EnterpriseTenantPostgresSession,
  campaignId: string): Promise<EnterpriseCampaignLeadSnapshotItem[]> {
  const result = await session.query<LeadRow>(`
    SELECT lead.id AS lead_id, lead.version AS lead_version,
      link.id AS link_id, link.version AS link_version,
      batch.id AS batch_id, batch.version AS batch_version,
      lead.country_code, lead.timezone, lead.language
    FROM enterprise.marketing_campaign_leads link
    JOIN enterprise.marketing_leads lead
      ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
    JOIN enterprise.marketing_lead_import_batches batch
      ON batch.tenant_id = link.tenant_id AND batch.id = link.import_batch_id
    WHERE link.tenant_id = $1 AND link.campaign_id = $2
      AND link.status = 'active' AND lead.status = 'active'
      AND batch.status = 'committed'
    ORDER BY lead.id, link.id
    FOR SHARE OF link, lead, batch
  `, [uuid(campaignId)]);
  return result.rows.map((row) => ({ leadId: uuid(row.lead_id),
    leadVersion: positive(row.lead_version), linkId: uuid(row.link_id),
    linkVersion: positive(row.link_version), batchId: uuid(row.batch_id),
    batchVersion: positive(row.batch_version), countryCode: country(row.country_code),
    timezone: nullableText(row.timezone, 64), language: nullableText(row.language, 64) }));
}
async function lockLeadPhones(session: EnterpriseTenantPostgresSession,
  campaignId: string) {
  await session.query(`
    SELECT pg_advisory_xact_lock(hashtextextended(
      $1::text || ':marketing-suppression:' || lead.phone_hash, 0))
    FROM enterprise.marketing_campaign_leads link
    JOIN enterprise.marketing_leads lead
      ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
    WHERE link.tenant_id = $1 AND link.campaign_id = $2
      AND link.status = 'active' AND lead.status = 'active'
    ORDER BY lead.phone_hash
  `, [uuid(campaignId)]);
}
async function loadPolicies(session: EnterpriseTenantPostgresSession,
  countries: string[], targetAt: string) {
  const result = await session.query<PolicyRow>(`
    SELECT id, country_code, policy_version, content_hash, effective_from, expires_at
    FROM enterprise.marketing_country_policy_versions
    WHERE tenant_id = $1 AND country_code = ANY($2::text[])
    ORDER BY country_code, effective_from, id
  `, [countries.map(country)]);
  const all = result.rows.map((row) => ({ countryCode: country(row.country_code),
    policyId: uuid(row.id), policyVersion: eventKey(row.policy_version),
    contentHash: hash(row.content_hash), effectiveFrom: iso(row.effective_from),
    expiresAt: iso(row.expires_at) }));
  const at = Date.parse(iso(targetAt));
  return { all, active: all.filter((policy) =>
    Date.parse(policy.effectiveFrom) <= at && Date.parse(policy.expiresAt) > at) };
}
async function loadConsents(session: EnterpriseTenantPostgresSession,
  campaignId: string, targetAt: string): Promise<EnterpriseCampaignConsentSnapshotItem[]> {
  const result = await session.query<ConsentRow>(`
    SELECT consent.id, consent.lead_id, consent.version,
      consent.evidence_sha256, consent.granted_at, consent.expires_at,
      consent.policy_version
    FROM enterprise.contact_consents consent
    JOIN enterprise.marketing_campaign_leads link
      ON link.tenant_id = consent.tenant_id AND link.campaign_id = consent.campaign_id
      AND link.lead_id = consent.lead_id
    JOIN enterprise.marketing_leads lead
      ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
    WHERE consent.tenant_id = $1 AND consent.campaign_id = $2
      AND consent.purpose = 'automated_marketing_call'
      AND consent.granted_at <= $3::timestamptz
      AND (consent.expires_at IS NULL OR consent.expires_at > $3::timestamptz)
      AND consent.revoked_at IS NULL AND link.status = 'active'
      AND lead.status = 'active'
    ORDER BY consent.lead_id, consent.granted_at DESC, consent.id DESC
    FOR SHARE OF consent
  `, [uuid(campaignId), iso(targetAt)]);
  const selected = new Map<string, EnterpriseCampaignConsentSnapshotItem>();
  for (const row of result.rows) { const leadId = uuid(row.lead_id);
    if (!selected.has(leadId)) selected.set(leadId, { leadId,
      consentId: uuid(row.id), consentVersion: positive(row.version),
      evidenceSha256: hash(row.evidence_sha256), grantedAt: iso(row.granted_at),
      expiresAt: row.expires_at === null ? null : iso(row.expires_at),
      policyVersion: eventKey(row.policy_version) }); }
  return [...selected.values()].sort((left, right) => left.leadId.localeCompare(right.leadId));
}
async function loadSuppressions(session: EnterpriseTenantPostgresSession,
  campaignId: string): Promise<EnterpriseCampaignSuppressionSnapshotItem[]> {
  const result = await session.query<SuppressionRow>(`
    SELECT lead.id AS lead_id, suppression.id, suppression.scope,
      suppression.created_at
    FROM enterprise.marketing_campaign_leads link
    JOIN enterprise.marketing_leads lead
      ON lead.tenant_id = link.tenant_id AND lead.id = link.lead_id
    JOIN enterprise.suppression_entries suppression
      ON suppression.tenant_id = lead.tenant_id
      AND suppression.phone_hash = lead.phone_hash
      AND suppression.scope IN ('tenant', 'global')
    WHERE link.tenant_id = $1 AND link.campaign_id = $2
      AND link.status = 'active' AND lead.status = 'active'
    ORDER BY lead.id, suppression.id
    FOR SHARE OF suppression
  `, [uuid(campaignId)]);
  return result.rows.map((row) => ({ leadId: uuid(row.lead_id),
    suppressionId: uuid(row.id), scope: scope(row.scope),
    createdAt: iso(row.created_at) }));
}
async function loadTimezones(session: EnterpriseTenantPostgresSession,
  campaignId: string, leads: EnterpriseCampaignLeadSnapshotItem[]) {
  const names = [...new Set(leads.flatMap((lead) => lead.timezone ? [lead.timezone] : []))];
  if (!names.length) return new Set<string>();
  const result = await session.query<{ name: string }>(`
    SELECT zone.name FROM pg_timezone_names zone
    WHERE zone.name = ANY($3::text[]) AND EXISTS (
      SELECT 1 FROM enterprise.marketing_campaigns campaign
      WHERE campaign.tenant_id = $1 AND campaign.id = $2
    )
  `, [uuid(campaignId), names]);
  return new Set(result.rows.map((row) => row.name));
}

function issuesFor(input: { campaign: EnterpriseCampaignRecord; targetAt?: string;
  leads: EnterpriseCampaignLeadSnapshotItem[];
  activePolicies: Awaited<ReturnType<typeof loadPolicies>>["active"];
  allPolicies: Awaited<ReturnType<typeof loadPolicies>>["all"];
  consents: EnterpriseCampaignConsentSnapshotItem[];
  suppressions: EnterpriseCampaignSuppressionSnapshotItem[];
  validTimezones: Set<string>; validatedAt: string }) {
  const issues: EnterpriseCampaignValidationIssue[] = [];
  if (!input.targetAt) issues.push({ code: "schedule_start_required" });
  else if (input.targetAt <= input.validatedAt) issues.push({ code: "schedule_start_elapsed" });
  if (!input.leads.length) issues.push({ code: "campaign_has_no_active_leads" });
  if (input.targetAt) for (const countryCode of input.campaign.countryCodes) {
    if (input.activePolicies.some((policy) => policy.countryCode === countryCode)) continue;
    const versions = input.allPolicies.filter((policy) => policy.countryCode === countryCode);
    issues.push({ code: versions.some((policy) => policy.effectiveFrom > input.targetAt!)
      ? "country_policy_not_yet_effective" : versions.length
        ? "country_policy_expired" : "country_policy_missing", countryCode });
  }
  const consentLeads = new Set(input.consents.map((item) => item.leadId));
  const suppressedLeads = new Set(input.suppressions.map((item) => item.leadId));
  for (const lead of input.leads) {
    if (!input.campaign.countryCodes.includes(lead.countryCode)) issues.push({
      code: "lead_country_mismatch", leadId: lead.leadId,
      countryCode: lead.countryCode });
    if (!lead.timezone || !input.validTimezones.has(lead.timezone)) issues.push({
      code: "lead_timezone_invalid", leadId: lead.leadId,
      countryCode: lead.countryCode });
    if (input.targetAt && !consentLeads.has(lead.leadId)) issues.push({
      code: "consent_missing", leadId: lead.leadId });
    if (suppressedLeads.has(lead.leadId)) issues.push({
      code: "target_suppressed", leadId: lead.leadId });
  }
  return issues;
}

interface LeadRow extends Record<string, unknown> { lead_id: string; lead_version: number | string;
  link_id: string; link_version: number | string; batch_id: string;
  batch_version: number | string; country_code: string; timezone: string | null;
  language: string | null; }
interface PolicyRow extends Record<string, unknown> { id: string; country_code: string;
  policy_version: string; content_hash: string; effective_from: string | Date;
  expires_at: string | Date; }
interface ConsentRow extends Record<string, unknown> { id: string; lead_id: string;
  version: number | string; evidence_sha256: string; granted_at: string | Date;
  expires_at: string | Date | null; policy_version: string; }
interface SuppressionRow extends Record<string, unknown> { id: string; lead_id: string;
  scope: string; created_at: string | Date; }
function uuid(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new Error("Invalid approval UUID"); return value; }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid approval hash"); return value; }
function country(value: unknown) { if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value)) throw new Error("Invalid approval country"); return value; }
function eventKey(value: unknown) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)) throw new Error("Invalid approval key"); return value; }
function positive(value: unknown) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid approval version"); return result; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value; if (typeof result !== "string" || new Date(result).toISOString() !== result) throw new Error("Invalid approval timestamp"); return result; }
function nullableText(value: unknown, max: number) { if (value === null) return null; if (typeof value !== "string" || !value || value.length > max) throw new Error("Invalid approval text"); return value; }
function scope(value: unknown) { if (value !== "tenant" && value !== "global") throw new Error("Invalid approval scope"); return value; }
