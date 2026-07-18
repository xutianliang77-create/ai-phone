import { randomUUID } from "node:crypto";
import type {
  EnterpriseKnowledgeSourceType,
  EnterpriseKnowledgeVersionStatus,
} from "@translation/contracts";
import type {
  CreateEnterpriseKnowledgeSourceInput,
  CreateEnterpriseKnowledgeVersionInput,
  PublishEnterpriseKnowledgeVersionInput,
  SearchEnterpriseKnowledgeInput,
  StageEnterpriseKnowledgeChunksInput,
} from "../../modules/enterprise/enterprise-knowledge.js";
import {
  prepareEnterpriseKnowledgeChunks,
  validateEnterpriseKnowledgeDimensions,
  validateEnterpriseKnowledgePublishTime,
  validateEnterpriseKnowledgeSearch,
} from "../../modules/enterprise/enterprise-knowledge.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export class EnterpriseKnowledgePostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  async createSource(input: CreateEnterpriseKnowledgeSourceInput) {
    const result = await this.session.query<KnowledgeSourceRow>(`
      INSERT INTO enterprise.knowledge_sources(
        tenant_id, id, name, source_type, status, created_by,
        created_at, updated_at, version
      ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $6, 1)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      input.id,
      input.name,
      input.sourceType,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.createdAt,
    ]);
    return result.rows[0]
      ? { status: "created" as const, source: mapSource(result.rows[0]) }
      : { status: "name_conflict" as const };
  }

  async listSources() {
    const result = await this.session.query<KnowledgeSourceRow>(`
      SELECT * FROM enterprise.knowledge_sources
      WHERE tenant_id = $1 AND status <> 'archived'
      ORDER BY updated_at DESC, id
    `);
    return result.rows.map(mapSource);
  }

  async createVersion(input: CreateEnterpriseKnowledgeVersionInput) {
    const dimensions = validateEnterpriseKnowledgeDimensions(input);
    const source = await this.session.query<{ id: string }>(`
      SELECT id FROM enterprise.knowledge_sources
      WHERE tenant_id = $1 AND id = $2 AND status = 'active'
      FOR UPDATE
    `, [input.sourceId]);
    if (!source.rows[0]) return { status: "source_not_found" as const };
    const revision = await this.session.query<{ next_revision: string }>(`
      SELECT (COALESCE(max(revision), 0) + 1)::text AS next_revision
      FROM enterprise.knowledge_versions
      WHERE tenant_id = $1 AND source_id = $2
    `, [input.sourceId]);
    const nextRevision = revision.rows[0]?.next_revision;
    if (!nextRevision) throw new Error("Enterprise knowledge revision allocation failed");
    const result = await this.session.query<KnowledgeVersionRow>(`
      INSERT INTO enterprise.knowledge_versions(
        tenant_id, id, source_id, revision, status, locale,
        country_code, product_code, created_at, version
      ) VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, 1)
      RETURNING *, 0::bigint AS chunk_count
    `, [
      input.id,
      input.sourceId,
      Number(nextRevision),
      dimensions.locale,
      dimensions.countryCode,
      dimensions.productCode,
      input.createdAt,
    ]);
    return { status: "created" as const, knowledgeVersion: mapVersion(result.rows[0]!) };
  }

  async listVersions(sourceId: string) {
    const result = await this.session.query<KnowledgeVersionRow>(`
      SELECT version_record.*,
        (SELECT count(*) FROM enterprise.knowledge_chunks chunk_record
          WHERE chunk_record.tenant_id = $1
            AND chunk_record.knowledge_version_id = version_record.id) AS chunk_count
      FROM enterprise.knowledge_versions version_record
      WHERE tenant_id = $1 AND source_id = $2
      ORDER BY revision DESC, id
    `, [sourceId]);
    return result.rows.map(mapVersion);
  }

  async stageChunks(input: StageEnterpriseKnowledgeChunksInput) {
    const current = await this.lockVersion(input.versionId);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "draft") return { status: "state_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const prepared = prepareEnterpriseKnowledgeChunks(input.chunks);
    const chunks = prepared.chunks.map((chunk) => ({
      id: randomUUID(),
      block_id: chunk.blockId,
      sequence: chunk.sequence,
      content: chunk.content,
      content_hash: chunk.contentHash,
    }));
    await this.session.query(`
      INSERT INTO enterprise.knowledge_chunks(
        tenant_id, id, knowledge_version_id, block_id, sequence,
        content, content_hash, created_at
      ) SELECT tenant_scope.tenant_id, chunk.id::uuid, $2,
          chunk.block_id, chunk.sequence,
          chunk.content, chunk.content_hash, $4
        FROM jsonb_to_recordset($3::jsonb) AS chunk(
          id text, block_id text, sequence integer,
          content text, content_hash text
        )
        CROSS JOIN (SELECT $1::uuid AS tenant_id) tenant_scope
        WHERE tenant_scope.tenant_id = $1
    `, [input.versionId, JSON.stringify(chunks), input.reviewedAt]);
    const result = await this.session.query<KnowledgeVersionRow>(`
      UPDATE enterprise.knowledge_versions
      SET status = 'review', content_hash = $3,
        reviewed_by = $4, reviewed_at = $5, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'draft' AND version = $6
      RETURNING *, $7::bigint AS chunk_count
    `, [
      input.versionId,
      prepared.contentHash,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.reviewedAt,
      input.expectedVersion,
      chunks.length,
    ]);
    if (!result.rows[0]) {
      throw new Error("Enterprise knowledge stage lost locked version");
    }
    return { status: "staged" as const, knowledgeVersion: mapVersion(result.rows[0]) };
  }

  async publish(input: PublishEnterpriseKnowledgeVersionInput) {
    validateEnterpriseKnowledgePublishTime(input);
    const current = await this.lockVersion(input.versionId);
    if (!current) return { status: "not_found" as const };
    if (current.status !== "review") return { status: "state_conflict" as const };
    if (Number(current.version) !== input.expectedVersion) {
      return { status: "version_conflict" as const };
    }
    const chunkCount = await this.chunkCount(input.versionId);
    if (chunkCount < 1 || !current.content_hash) {
      return { status: "state_conflict" as const };
    }
    const result = await this.session.query<KnowledgeVersionRow>(`
      UPDATE enterprise.knowledge_versions
      SET status = 'published', effective_from = $3, expires_at = $4,
        published_by = $5, published_at = $6, version = version + 1
      WHERE tenant_id = $1 AND id = $2 AND status = 'review' AND version = $7
      RETURNING *, $8::bigint AS chunk_count
    `, [
      input.versionId,
      input.effectiveFrom,
      input.expiresAt ?? null,
      enterprisePostgresAccountSubjectId(this.session.context.actorUserId),
      input.publishedAt,
      input.expectedVersion,
      chunkCount,
    ]);
    if (!result.rows[0]) {
      throw new Error("Enterprise knowledge publish lost locked version");
    }
    await this.session.query(`
      UPDATE enterprise.knowledge_sources
      SET updated_at = $3, version = version + 1
      WHERE tenant_id = $1 AND id = $2
    `, [current.source_id, input.publishedAt]);
    return { status: "published" as const, knowledgeVersion: mapVersion(result.rows[0]) };
  }

  async search(input: SearchEnterpriseKnowledgeInput) {
    const search = validateEnterpriseKnowledgeSearch(input);
    const result = await this.session.query<KnowledgeSearchRow>(`
      WITH active_versions AS (
        SELECT DISTINCT ON (source_id)
          id, source_id, revision
        FROM enterprise.knowledge_versions
        WHERE tenant_id = $1 AND status = 'published'
          AND locale = $2 AND country_code IN ($3, 'ALL')
          AND product_code IN ($4, 'all')
          AND effective_from <= $5
          AND (expires_at IS NULL OR expires_at > $5)
        ORDER BY source_id, revision DESC, id
      )
      SELECT active.id AS knowledge_version_id, active.source_id,
        active.revision, chunk.block_id, chunk.content, chunk.content_hash
      FROM active_versions active
      JOIN enterprise.knowledge_chunks chunk
        ON chunk.tenant_id = $1 AND chunk.knowledge_version_id = active.id
      WHERE strpos(lower(chunk.content), lower($6)) > 0
      ORDER BY strpos(lower(chunk.content), lower($6)), chunk.sequence, chunk.id
      LIMIT $7
    `, [
      search.locale,
      search.countryCode,
      search.productCode,
      search.now,
      search.query,
      search.limit,
    ]);
    return result.rows.map((row) => ({
      knowledgeVersionId: row.knowledge_version_id,
      sourceId: row.source_id,
      revision: Number(row.revision),
      blockId: row.block_id,
      content: row.content,
      contentHash: row.content_hash,
      citation: `${row.knowledge_version_id}:${row.block_id}`,
    }));
  }

  private async lockVersion(id: string) {
    const result = await this.session.query<KnowledgeVersionRow>(`
      SELECT *, 0::bigint AS chunk_count
      FROM enterprise.knowledge_versions
      WHERE tenant_id = $1 AND id = $2
      FOR UPDATE
    `, [id]);
    return result.rows[0] ?? null;
  }

  private async chunkCount(versionId: string) {
    const result = await this.session.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM enterprise.knowledge_chunks
      WHERE tenant_id = $1 AND knowledge_version_id = $2
    `, [versionId]);
    return Number(result.rows[0]?.count ?? 0);
  }
}

interface KnowledgeSourceRow extends Record<string, unknown> {
  id: string; tenant_id: string; name: string;
  source_type: EnterpriseKnowledgeSourceType; status: "active" | "archived";
  created_by: string; created_at: string | Date; updated_at: string | Date;
  version: string | number;
}

interface KnowledgeVersionRow extends Record<string, unknown> {
  id: string; tenant_id: string; source_id: string; revision: string | number;
  status: EnterpriseKnowledgeVersionStatus; locale: string; country_code: string;
  product_code: string; content_hash: string | null; chunk_count: string | number;
  effective_from: string | Date | null; published_at: string | Date | null;
  expires_at: string | Date | null; created_at: string | Date;
  version: string | number;
}

interface KnowledgeSearchRow extends Record<string, unknown> {
  knowledge_version_id: string; source_id: string; revision: string | number;
  block_id: string; content: string; content_hash: string;
}

function mapSource(row: KnowledgeSourceRow) {
  return {
    id: row.id, tenantId: row.tenant_id, name: row.name,
    sourceType: row.source_type, status: row.status, createdBy: row.created_by,
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
    version: Number(row.version),
  };
}

function mapVersion(row: KnowledgeVersionRow) {
  return {
    id: row.id, tenantId: row.tenant_id, sourceId: row.source_id,
    revision: Number(row.revision), status: row.status, locale: row.locale,
    countryCode: row.country_code, productCode: row.product_code,
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    chunkCount: Number(row.chunk_count),
    ...(row.effective_from ? { effectiveFrom: timestamp(row.effective_from) } : {}),
    ...(row.published_at ? { publishedAt: timestamp(row.published_at) } : {}),
    ...(row.expires_at ? { expiresAt: timestamp(row.expires_at) } : {}),
    createdAt: timestamp(row.created_at), version: Number(row.version),
  };
}

function timestamp(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
