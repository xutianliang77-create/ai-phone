import type {
  EnterpriseContentVersionStatus,
  EnterpriseTerminologyPurpose,
} from "@translation/contracts";
import {
  prepareEnterpriseScriptContent,
  validateEnterpriseScriptDimensions,
  validateEnterpriseScriptPurpose,
  type EnterpriseScriptTemplateContent,
} from "../../modules/enterprise/enterprise-script-template.js";
import {
  validateEnterpriseVersionWindow,
  type PublishEnterpriseVersionInput,
} from "../../modules/enterprise/enterprise-terminology.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export class EnterpriseScriptTemplatePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createTemplate(input: {
    id: string; name: string; purpose: EnterpriseTerminologyPurpose; createdAt: string;
  }) {
    const purpose = validateEnterpriseScriptPurpose(input.purpose);
    const result = await this.session.query<ScriptTemplateRow>(`
      INSERT INTO enterprise.script_templates(
        tenant_id, id, name, purpose, status, created_by,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $6, 1)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      input.id, input.name, purpose,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.createdAt,
    ]);
    return result.rows[0]
      ? { status: "created" as const, scriptTemplate: mapTemplate(result.rows[0]) }
      : { status: "name_conflict" as const };
  }

  async listTemplates() {
    const result = await this.session.query<ScriptTemplateRow>(`
      SELECT * FROM enterprise.script_templates
      WHERE tenant_id = $1 AND status = 'active'
      ORDER BY updated_at DESC, id
    `);
    return result.rows.map(mapTemplate);
  }

  async createVersion(input: {
    id: string; scriptTemplateId: string;
    locale: string; countryCode: string; productCode: string; createdAt: string;
  }) {
    const dimensions = validateEnterpriseScriptDimensions(input);
    const template = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.script_templates
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'
      FOR UPDATE
    `, [input.scriptTemplateId]);
    if (!template.rows[0]) return { status: "template_not_found" as const };
    const revision = await this.session.query<{ next_revision: string }>(`
      SELECT (COALESCE(max(revision), 0) + 1)::text AS next_revision
      FROM enterprise.script_template_versions
      WHERE tenant_id = $1 AND script_template_id = $2
    `, [input.scriptTemplateId]);
    const nextRevision = Number(revision.rows[0]?.next_revision);
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      throw new Error("Enterprise script revision allocation failed");
    }
    const result = await this.session.query<ScriptVersionRow>(`
      INSERT INTO enterprise.script_template_versions(
        tenant_id, id, script_template_id, revision, status,
        locale, country_code, product_code, created_at, version
      ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, 1)
      RETURNING *
    `, [
      input.id, input.scriptTemplateId, nextRevision,
      dimensions.locale, dimensions.countryCode, dimensions.productCode,
      input.createdAt,
    ]);
    return { status: "created" as const, scriptTemplateVersion: mapVersion(result.rows[0]!) };
  }

  async listVersions(scriptTemplateId: string) {
    const result = await this.session.query<ScriptVersionRow>(`
      SELECT * FROM enterprise.script_template_versions
      WHERE tenant_id = $1 AND script_template_id = $2
      ORDER BY revision DESC, id
    `, [scriptTemplateId]);
    return result.rows.map(mapVersion);
  }

  async stageVersion(input: {
    versionId: string; expectedVersion: number;
    content: EnterpriseScriptTemplateContent; reviewedAt: string;
  }) {
    const current = await this.lockVersion(input.versionId);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "draft") return { status: "state_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const content = prepareEnterpriseScriptContent(input.content);
    const result = await this.session.query<ScriptVersionRow>(`
      UPDATE enterprise.script_template_versions
      SET status = 'review', prompt_text = $3,
        required_phrases = $4::jsonb, prohibited_phrases = $5::jsonb,
        variables = $6::jsonb, content_hash = $7,
        reviewed_by = $8, reviewed_at = $9, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'draft' AND version = $10
      RETURNING *
    `, [
      input.versionId, content.promptText,
      JSON.stringify(content.requiredPhrases), JSON.stringify(content.prohibitedPhrases),
      JSON.stringify(content.variables), content.contentHash,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.reviewedAt, input.expectedVersion,
    ]);
    if (!result.rows[0]) throw new Error("Enterprise script stage lost lock");
    return { status: "staged" as const, scriptTemplateVersion: mapVersion(result.rows[0]) };
  }

  async publishVersion(input: PublishEnterpriseVersionInput) {
    validateEnterpriseVersionWindow(input);
    const current = await this.lockVersion(input.versionId);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "review") return { status: "state_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const result = await this.session.query<ScriptVersionRow>(`
      UPDATE enterprise.script_template_versions
      SET status = 'published', effective_from = $3, expires_at = $4,
        published_by = $5, published_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'review' AND version = $7
      RETURNING *
    `, [
      input.versionId, input.effectiveFrom, input.expiresAt ?? null,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.publishedAt, input.expectedVersion,
    ]);
    if (!result.rows[0]) throw new Error("Enterprise script publish lost lock");
    await this.session.query(`
      UPDATE enterprise.script_templates
      SET updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2
    `, [current.script_template_id, input.publishedAt]);
    return { status: "published" as const, scriptTemplateVersion: mapVersion(result.rows[0]) };
  }

  async resolve(input: {
    scriptTemplateId: string; locale: string; countryCode: string;
    productCode: string; purpose: Exclude<EnterpriseTerminologyPurpose, "all">; now: string;
  }) {
    const result = await this.session.query<ResolvedScriptRow>(`
      SELECT version_record.*, template_record.purpose
      FROM enterprise.script_template_versions version_record
      JOIN enterprise.script_templates template_record
        ON template_record.tenant_id = $1
        AND template_record.id = version_record.script_template_id
      WHERE version_record.tenant_id = $1
        AND version_record.script_template_id = $2
        AND version_record.status = 'published' AND template_record.status = 'active'
        AND template_record.purpose IN ($3, 'all') AND version_record.locale = $4
        AND version_record.country_code IN ($5, 'ALL')
        AND version_record.product_code IN ($6, 'all')
        AND version_record.effective_from <= $7
        AND (version_record.expires_at IS NULL OR version_record.expires_at > $7)
      ORDER BY version_record.revision DESC, version_record.id
      LIMIT 1
    `, [
      input.scriptTemplateId, input.purpose, input.locale,
      input.countryCode, input.productCode, input.now,
    ]);
    const row = result.rows[0];
    if (!row?.content_hash) return null;
    const content = prepareEnterpriseScriptContent({
      promptText: row.prompt_text,
      requiredPhrases: row.required_phrases,
      prohibitedPhrases: row.prohibited_phrases,
      variables: row.variables,
    });
    if (content.contentHash !== row.content_hash) {
      throw new Error("Enterprise script content hash mismatch");
    }
    return { version: mapVersion(row), content, contentHash: row.content_hash };
  }

  private async lockVersion(id: string) {
    const result = await this.session.query<ScriptVersionRow>(`
      SELECT * FROM enterprise.script_template_versions
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `, [id]);
    return result.rows[0] ?? null;
  }
}

interface ScriptTemplateRow extends Record<string, unknown> {
  id: string; tenant_id: string; name: string; purpose: EnterpriseTerminologyPurpose;
  status: "active" | "archived"; created_by: string;
  created_at: string | Date; updated_at: string | Date; version: string | number;
}
interface ScriptVersionRow extends Record<string, unknown> {
  id: string; tenant_id: string; script_template_id: string; revision: string | number;
  status: EnterpriseContentVersionStatus; locale: string; country_code: string;
  product_code: string; prompt_text: string; required_phrases: string[];
  prohibited_phrases: string[]; variables: string[]; content_hash: string | null;
  effective_from: string | Date | null; published_at: string | Date | null;
  expires_at: string | Date | null; created_at: string | Date; version: string | number;
}
interface ResolvedScriptRow extends ScriptVersionRow { purpose: EnterpriseTerminologyPurpose }

function mapTemplate(row: ScriptTemplateRow) {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name, purpose: row.purpose,
    status: row.status, createdBy: row.created_by,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
    version: Number(row.version),
  };
}
function mapVersion(row: ScriptVersionRow) {
  return {
    id: row.id, tenantId: row.tenant_id, scriptTemplateId: row.script_template_id,
    revision: Number(row.revision), status: row.status, locale: row.locale,
    countryCode: row.country_code, productCode: row.product_code,
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    requiredPhraseCount: row.required_phrases.length,
    prohibitedPhraseCount: row.prohibited_phrases.length,
    variableCount: row.variables.length,
    ...(row.effective_from ? { effectiveFrom: timestamp(row.effective_from) } : {}),
    ...(row.published_at ? { publishedAt: timestamp(row.published_at) } : {}),
    ...(row.expires_at ? { expiresAt: timestamp(row.expires_at) } : {}),
    createdAt: timestamp(row.created_at), version: Number(row.version),
  };
}
function timestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
