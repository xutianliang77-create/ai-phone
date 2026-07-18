import type {
  EnterpriseContentVersionStatus,
  EnterpriseTermEntryDto,
  EnterpriseTerminologyPurpose,
} from "@translation/contracts";
import {
  prepareEnterpriseTerms,
  validateEnterpriseTermDimensions,
  validateEnterpriseVersionWindow,
  type EnterpriseTermPackVersionDimensions,
  type PublishEnterpriseVersionInput,
  type StageEnterpriseTermPackInput,
} from "../../modules/enterprise/enterprise-terminology.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export class EnterpriseTermPackPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createPack(input: { id: string; name: string; createdAt: string }) {
    const result = await this.session.query<TermPackRow>(`
      INSERT INTO enterprise.term_packs(
        tenant_id, id, name, status, created_by, created_at, updated_at, version
      ) VALUES ($1, $2, $3, 'active', $4, $5, $5, 1)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      input.id, input.name,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.createdAt,
    ]);
    return result.rows[0]
      ? { status: "created" as const, termPack: mapPack(result.rows[0]) }
      : { status: "name_conflict" as const };
  }

  async listPacks() {
    const result = await this.session.query<TermPackRow>(`
      SELECT * FROM enterprise.term_packs
      WHERE tenant_id = $1 AND status = 'active'
      ORDER BY updated_at DESC, id
    `);
    return result.rows.map(mapPack);
  }

  async createVersion(input: {
    id: string;
    termPackId: string;
    dimensions: EnterpriseTermPackVersionDimensions;
    createdAt: string;
  }) {
    const dimensions = validateEnterpriseTermDimensions(input.dimensions);
    const pack = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.term_packs
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'
      FOR UPDATE
    `, [input.termPackId]);
    if (!pack.rows[0]) return { status: "pack_not_found" as const };
    const revision = await this.session.query<{ next_revision: string }>(`
      SELECT (COALESCE(max(revision), 0) + 1)::text AS next_revision
      FROM enterprise.term_pack_versions
      WHERE tenant_id = $1 AND term_pack_id = $2
    `, [input.termPackId]);
    const nextRevision = Number(revision.rows[0]?.next_revision);
    if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) {
      throw new Error("Enterprise term pack revision allocation failed");
    }
    const result = await this.session.query<TermPackVersionRow>(`
      INSERT INTO enterprise.term_pack_versions(
        tenant_id, id, term_pack_id, revision, status,
        source_locale, target_locale, country_code, product_code, usage_scope,
        created_at, version
      ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10, 1)
      RETURNING *
    `, [
      input.id, input.termPackId, nextRevision,
      dimensions.sourceLocale, dimensions.targetLocale,
      dimensions.countryCode, dimensions.productCode, dimensions.usageScope,
      input.createdAt,
    ]);
    return {
      status: "created" as const,
      termPackVersion: mapVersion(result.rows[0]!),
    };
  }

  async listVersions(termPackId: string) {
    const result = await this.session.query<TermPackVersionRow>(`
      SELECT * FROM enterprise.term_pack_versions
      WHERE tenant_id = $1 AND term_pack_id = $2
      ORDER BY revision DESC, id
    `, [termPackId]);
    return result.rows.map(mapVersion);
  }

  async stageVersion(input: StageEnterpriseTermPackInput) {
    const current = await this.lockVersion(input.versionId);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "draft") return { status: "state_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const prepared = prepareEnterpriseTerms(input.terms);
    const result = await this.session.query<TermPackVersionRow>(`
      UPDATE enterprise.term_pack_versions
      SET status = 'review', terms = $3::jsonb, content_hash = $4,
        reviewed_by = $5, reviewed_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'draft' AND version = $7
      RETURNING *
    `, [
      input.versionId, JSON.stringify(prepared.terms), prepared.contentHash,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.reviewedAt, input.expectedVersion,
    ]);
    if (!result.rows[0]) throw new Error("Enterprise term pack stage lost lock");
    return { status: "staged" as const, termPackVersion: mapVersion(result.rows[0]) };
  }

  async publishVersion(input: PublishEnterpriseVersionInput) {
    validateEnterpriseVersionWindow(input);
    const current = await this.lockVersion(input.versionId);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "review") return { status: "state_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const result = await this.session.query<TermPackVersionRow>(`
      UPDATE enterprise.term_pack_versions
      SET status = 'published', effective_from = $3, expires_at = $4,
        published_by = $5, published_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'review' AND version = $7
      RETURNING *
    `, [
      input.versionId, input.effectiveFrom, input.expiresAt ?? null,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.publishedAt, input.expectedVersion,
    ]);
    if (!result.rows[0]) throw new Error("Enterprise term pack publish lost lock");
    await this.session.query(`
      UPDATE enterprise.term_packs
      SET updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2
    `, [current.term_pack_id, input.publishedAt]);
    return { status: "published" as const, termPackVersion: mapVersion(result.rows[0]) };
  }

  async resolve(input: {
    termPackId: string;
    sourceLocale: string;
    targetLocale: string;
    countryCode: string;
    productCode: string;
    purpose: Exclude<EnterpriseTerminologyPurpose, "all">;
    now: string;
  }) {
    const result = await this.session.query<TermPackVersionRow>(`
      SELECT * FROM enterprise.term_pack_versions
      WHERE tenant_id = $1 AND term_pack_id = $2 AND status = 'published'
        AND source_locale = $3 AND target_locale = $4
        AND country_code IN ($5, 'ALL') AND product_code IN ($6, 'all')
        AND usage_scope IN ($7, 'all') AND effective_from <= $8
        AND (expires_at IS NULL OR expires_at > $8)
      ORDER BY revision DESC, id
      LIMIT 1
    `, [
      input.termPackId, input.sourceLocale, input.targetLocale,
      input.countryCode, input.productCode, input.purpose, input.now,
    ]);
    const row = result.rows[0];
    if (!row?.content_hash) return null;
    const prepared = prepareEnterpriseTerms(row.terms);
    if (prepared.contentHash !== row.content_hash) {
      throw new Error("Enterprise term pack content hash mismatch");
    }
    return { version: mapVersion(row), terms: prepared.terms, contentHash: row.content_hash };
  }

  private async lockVersion(id: string) {
    const result = await this.session.query<TermPackVersionRow>(`
      SELECT * FROM enterprise.term_pack_versions
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `, [id]);
    return result.rows[0] ?? null;
  }
}

interface TermPackRow extends Record<string, unknown> {
  id: string; tenant_id: string; name: string; status: "active" | "archived";
  created_by: string | null; created_at: string | Date; updated_at: string | Date;
  version: string | number;
}
interface TermPackVersionRow extends Record<string, unknown> {
  id: string; tenant_id: string; term_pack_id: string; revision: string | number;
  status: EnterpriseContentVersionStatus; source_locale: string; target_locale: string;
  country_code: string; product_code: string; usage_scope: EnterpriseTerminologyPurpose;
  terms: EnterpriseTermEntryDto[]; content_hash: string | null;
  effective_from: string | Date | null; published_at: string | Date | null;
  expires_at: string | Date | null; created_at: string | Date; version: string | number;
}

function mapPack(row: TermPackRow) {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name, status: row.status,
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
    version: Number(row.version),
  };
}
function mapVersion(row: TermPackVersionRow) {
  return {
    id: row.id, tenantId: row.tenant_id, termPackId: row.term_pack_id,
    revision: Number(row.revision), status: row.status,
    sourceLocale: row.source_locale, targetLocale: row.target_locale,
    countryCode: row.country_code, productCode: row.product_code,
    usageScope: row.usage_scope, ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    termCount: row.terms.length,
    ...(row.effective_from ? { effectiveFrom: timestamp(row.effective_from) } : {}),
    ...(row.published_at ? { publishedAt: timestamp(row.published_at) } : {}),
    ...(row.expires_at ? { expiresAt: timestamp(row.expires_at) } : {}),
    createdAt: timestamp(row.created_at), version: Number(row.version),
  };
}
function timestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
