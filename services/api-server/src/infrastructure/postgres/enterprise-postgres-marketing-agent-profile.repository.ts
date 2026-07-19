import type { UpsertEnterpriseMarketingAgentProfileRequest } from
  "@translation/contracts";
import { createEnterpriseRuntimeContext } from
  "../../modules/enterprise/enterprise-terminology.js";
import type { EnterpriseMarketingAgentProfileRecord,
  EnterpriseMarketingAgentResolvedContent } from
  "../../modules/enterprise/enterprise-marketing-agent.js";
import type { EnterpriseTenantPostgresSession } from
  "./enterprise-postgres-tenant-session.js";

export class EnterpriseMarketingAgentProfilePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async list(campaignId: string) {
    const result = await this.session.query<ProfileRow>(`
      SELECT * FROM enterprise.marketing_agent_profiles
      WHERE tenant_id = $1 AND campaign_id = $2
      ORDER BY country_code, locale, id
    `, [uuid(campaignId)]);
    return result.rows.map(mapProfile);
  }

  async upsert(input: {
    id: string; campaignId: string; actorUserId: string;
    idempotencyKey: string; requestHash: string; occurredAt: string;
    profile: Omit<UpsertEnterpriseMarketingAgentProfileRequest,
      "tenantId" | "expectedVersion">; expectedVersion?: number;
  }) {
    const existing = await this.findByDimensions(input.campaignId,
      input.profile.countryCode, input.profile.locale, true);
    if (!existing) {
      if (input.expectedVersion !== undefined) return { status: "version_conflict" as const };
      const inserted = await this.session.query<ProfileRow>(`
        INSERT INTO enterprise.marketing_agent_profiles(
          tenant_id, id, campaign_id, country_code, locale, brand_name,
          agent_identity, call_purpose, product_code, value_proposition, target_market,
          term_pack_id, script_template_id, voice_preset_id, opening_disclosure,
          qualification_questions, opt_out_phrases, handoff_phrases, closing_text,
          created_by, creation_key, creation_request_hash, last_command_key,
          last_command_hash, created_at, updated_at, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21,
          $22, $21, $22, $23, $23, 1)
        ON CONFLICT DO NOTHING RETURNING *
      `, values(input));
      if (inserted.rows[0]) return { status: "created" as const,
        profile: mapProfile(inserted.rows[0]) };
      const replay = await this.findByCreation(input.actorUserId, input.idempotencyKey);
      return replay && replay.creationRequestHash === input.requestHash
        ? { status: "replayed" as const, profile: replay }
        : { status: "idempotency_conflict" as const };
    }
    if (existing.lastCommandKey === input.idempotencyKey) {
      return existing.lastCommandHash === input.requestHash
        ? { status: "replayed" as const, profile: existing }
        : { status: "idempotency_conflict" as const };
    }
    if (input.expectedVersion !== existing.version) {
      return { status: "version_conflict" as const };
    }
    const profile = input.profile;
    const updated = await this.session.query<ProfileRow>(`
      UPDATE enterprise.marketing_agent_profiles SET brand_name = $3,
        agent_identity = $4, call_purpose = $5, product_code = $6,
        value_proposition = $7, target_market = $8, term_pack_id = $9,
        script_template_id = $10, voice_preset_id = $11, opening_disclosure = $12,
        qualification_questions = $13::jsonb, opt_out_phrases = $14::jsonb,
        handoff_phrases = $15::jsonb, closing_text = $16,
        last_command_key = $17, last_command_hash = $18, updated_at = $19,
        version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND version = $20 RETURNING *
    `, [existing.id, text(profile.brandName, 200), text(profile.agentIdentity, 500),
      text(profile.callPurpose, 1_000), code(profile.productCode, 80),
      text(profile.valueProposition, 2_000),
      text(profile.targetMarket, 1_000), uuid(profile.termPackId),
      uuid(profile.scriptTemplateId), code(profile.voicePresetId, 80),
      text(profile.openingDisclosure, 2_000), JSON.stringify(profile.qualificationQuestions),
      JSON.stringify(profile.optOutPhrases), JSON.stringify(profile.handoffPhrases),
      text(profile.closingText, 2_000), key(input.idempotencyKey), hash(input.requestHash),
      iso(input.occurredAt), existing.version]);
    return updated.rows[0] ? { status: "updated" as const,
      profile: mapProfile(updated.rows[0]) } : { status: "version_conflict" as const };
  }

  async resolve(campaignId: string, countryCode: string, locale: string) {
    return this.findByDimensions(campaignId, countryCode, locale);
  }

  async targetForTask(taskId: string, generation: number) {
    const result = await this.session.query<TaskTargetRow>(`
      SELECT task.campaign_id, task.lead_id, lead.country_code,
        COALESCE(lead.language, campaign.language_codes[1]) AS locale
      FROM enterprise.marketing_call_tasks task
      JOIN enterprise.marketing_campaigns campaign
        ON campaign.tenant_id = task.tenant_id AND campaign.id = task.campaign_id
      JOIN enterprise.marketing_leads lead
        ON lead.tenant_id = task.tenant_id AND lead.id = task.lead_id
      WHERE task.tenant_id = $1 AND task.id = $2 AND task.status = 'dispatching'
        AND task.dispatch_generation = $3 FOR UPDATE OF task
    `, [uuid(taskId), positive(generation)]);
    const row = result.rows[0];
    return row ? { campaignId: uuid(row.campaign_id), leadId: uuid(row.lead_id),
      countryCode: country(row.country_code), locale: localeCode(row.locale) } : null;
  }

  async loadFrozen(input: { profileId: string; profileVersion: number;
    termPackVersionId: string; scriptTemplateVersionId: string;
    contentContextHash: string }): Promise<EnterpriseMarketingAgentResolvedContent | null> {
    const profileResult = await this.session.query<ProfileRow>(`
      SELECT * FROM enterprise.marketing_agent_profiles
      WHERE tenant_id = $1 AND id = $2 AND version = $3
    `, [uuid(input.profileId), positive(input.profileVersion)]);
    const terms = await this.session.query<TermVersionRow>(`
      SELECT id, content_hash, terms FROM enterprise.term_pack_versions
      WHERE tenant_id = $1 AND id = $2 AND status = 'published'
    `, [uuid(input.termPackVersionId)]);
    const script = await this.session.query<ScriptVersionRow>(`
      SELECT id, content_hash, prompt_text, required_phrases,
        prohibited_phrases, variables FROM enterprise.script_template_versions
      WHERE tenant_id = $1 AND id = $2 AND status = 'published'
    `, [uuid(input.scriptTemplateVersionId)]);
    const profile = profileResult.rows[0] ? mapProfile(profileResult.rows[0]) : null;
    const term = terms.rows[0]; const scriptVersion = script.rows[0];
    if (!profile || !term?.content_hash || !scriptVersion?.content_hash) return null;
    const terminology = createEnterpriseRuntimeContext({
      termPackVersionId: term.id, termContentHash: term.content_hash,
      terms: term.terms, scriptTemplateVersionId: scriptVersion.id,
      scriptContentHash: scriptVersion.content_hash,
      script: { promptText: scriptVersion.prompt_text,
        requiredPhrases: scriptVersion.required_phrases,
        prohibitedPhrases: scriptVersion.prohibited_phrases,
        variables: scriptVersion.variables },
    });
    return terminology.contextHash === input.contentContextHash
      ? { profile, terminology } : null;
  }

  private async findByDimensions(campaignId: string, countryCode: string,
    locale: string, lock = false) {
    const result = await this.session.query<ProfileRow>(`
      SELECT * FROM enterprise.marketing_agent_profiles
      WHERE tenant_id = $1 AND campaign_id = $2 AND country_code = $3 AND locale = $4
      ${lock ? "FOR UPDATE" : ""}
    `, [uuid(campaignId), country(countryCode), localeCode(locale)]);
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }

  private async findByCreation(actorUserId: string, creationKey: string) {
    const result = await this.session.query<ProfileRow>(`
      SELECT * FROM enterprise.marketing_agent_profiles
      WHERE tenant_id = $1 AND created_by = $2 AND creation_key = $3
    `, [actorUserId, key(creationKey)]);
    return result.rows[0] ? mapProfile(result.rows[0]) : null;
  }
}

function values(input: Parameters<EnterpriseMarketingAgentProfilePostgresRepository["upsert"]>[0]) {
  const p = input.profile;
  return [uuid(input.id), uuid(input.campaignId), country(p.countryCode),
    localeCode(p.locale), text(p.brandName, 200), text(p.agentIdentity, 500),
    text(p.callPurpose, 1_000), code(p.productCode, 80),
    text(p.valueProposition, 2_000), text(p.targetMarket, 1_000),
    uuid(p.termPackId), uuid(p.scriptTemplateId), code(p.voicePresetId, 80),
    text(p.openingDisclosure, 2_000), JSON.stringify(p.qualificationQuestions),
    JSON.stringify(p.optOutPhrases), JSON.stringify(p.handoffPhrases),
    text(p.closingText, 2_000), input.actorUserId, key(input.idempotencyKey),
    hash(input.requestHash), iso(input.occurredAt)];
}

function mapProfile(row: ProfileRow): EnterpriseMarketingAgentProfileRecord {
  return { id: row.id, tenantId: row.tenant_id, campaignId: row.campaign_id,
    countryCode: row.country_code, locale: row.locale, brandName: row.brand_name,
    agentIdentity: row.agent_identity, callPurpose: row.call_purpose,
    productCode: row.product_code,
    valueProposition: row.value_proposition, targetMarket: row.target_market,
    termPackId: row.term_pack_id, scriptTemplateId: row.script_template_id,
    voicePresetId: row.voice_preset_id, openingDisclosure: row.opening_disclosure,
    qualificationQuestions: strings(row.qualification_questions),
    optOutPhrases: strings(row.opt_out_phrases),
    handoffPhrases: strings(row.handoff_phrases), closingText: row.closing_text,
    createdBy: row.created_by, creationKey: row.creation_key,
    creationRequestHash: row.creation_request_hash,
    lastCommandKey: row.last_command_key, lastCommandHash: row.last_command_hash,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    version: positive(row.version) };
}

interface ProfileRow extends Record<string, unknown> { id: string; tenant_id: string;
  campaign_id: string; country_code: string; locale: string; brand_name: string;
  agent_identity: string; call_purpose: string; product_code: string;
  value_proposition: string;
  target_market: string; term_pack_id: string; script_template_id: string;
  voice_preset_id: string; opening_disclosure: string; qualification_questions: string[];
  opt_out_phrases: string[]; handoff_phrases: string[]; closing_text: string;
  created_by: string; creation_key: string; creation_request_hash: string;
  last_command_key: string; last_command_hash: string; created_at: string | Date;
  updated_at: string | Date; version: number | string; }
interface TermVersionRow extends Record<string, unknown> { id: string;
  content_hash: string | null; terms: EnterpriseMarketingAgentResolvedContent["terminology"]["terms"]; }
interface ScriptVersionRow extends Record<string, unknown> { id: string;
  content_hash: string | null; prompt_text: string; required_phrases: string[];
  prohibited_phrases: string[]; variables: string[]; }
interface TaskTargetRow extends Record<string, unknown> { campaign_id: string;
  lead_id: string; country_code: string; locale: string; }
function strings(value: unknown) { if (!Array.isArray(value) ||
  value.some((item) => typeof item !== "string")) throw new Error("Invalid agent strings");
  return value as string[]; }
function uuid(value: unknown) { if (typeof value !== "string" ||
  !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
  throw new Error("Invalid Marketing Agent UUID"); return value; }
function positive(value: unknown) { const number = Number(value); if (!Number.isSafeInteger(number) ||
  number < 1) throw new Error("Invalid Marketing Agent number"); return number; }
function text(value: unknown, max: number) { if (typeof value !== "string" || !value.trim() ||
  value !== value.trim() || Buffer.byteLength(value) > max) throw new Error("Invalid agent text"); return value; }
function code(value: unknown, max: number) { if (typeof value !== "string" ||
  Buffer.byteLength(value) > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value))
  throw new Error("Invalid agent code"); return value; }
function key(value: unknown) { return code(value, 160); }
function hash(value: unknown) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
  throw new Error("Invalid agent hash"); return value; }
function country(value: unknown) { if (typeof value !== "string" || !/^[A-Z]{2}$/.test(value))
  throw new Error("Invalid agent country"); return value; }
function localeCode(value: unknown) { if (typeof value !== "string" ||
  !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value))
  throw new Error("Invalid agent locale"); return value; }
function iso(value: unknown) { const result = value instanceof Date ? value.toISOString() : value;
  if (typeof result !== "string" || new Date(result).toISOString() !== result)
    throw new Error("Invalid agent timestamp"); return result; }
