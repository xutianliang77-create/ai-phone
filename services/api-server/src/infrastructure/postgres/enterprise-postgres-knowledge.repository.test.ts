import { describe, expect, it } from "vitest";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseKnowledgePostgresRepository,
} from "./enterprise-postgres-knowledge.repository.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000021";
const knowledgeVersionId = "00000000-0000-4000-8000-000000000022";
const now = "2026-07-18T10:00:00.000Z";

describe("enterprise PostgreSQL knowledge repository", () => {
  it("allocates a tenant/source revision under a source lock", async () => {
    const fixture = knowledgeFixture("create");
    const repository = new EnterpriseKnowledgePostgresRepository(fixture.session);

    await expect(repository.createVersion({
      id: knowledgeVersionId,
      sourceId,
      locale: "zh-CN",
      countryCode: "CN",
      productCode: "phone-pro",
      createdAt: now,
    })).resolves.toMatchObject({
      status: "created",
      knowledgeVersion: { revision: 2, status: "draft", chunkCount: 0 },
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("enterprise.knowledge_sources") && sql.includes("FOR UPDATE")
    )).toBe(true);
  });

  it("stages one immutable chunk set and transitions draft to review", async () => {
    const fixture = knowledgeFixture("stage");
    const repository = new EnterpriseKnowledgePostgresRepository(fixture.session);

    const result = await repository.stageChunks({
      versionId: knowledgeVersionId,
      expectedVersion: 1,
      chunks: [
        { blockId: "b1", content: "退款申请需要订单编号。" },
        { blockId: "b2", content: "无法确认时转人工客服。" },
      ],
      reviewedAt: now,
    });

    expect(result).toMatchObject({
      status: "staged",
      knowledgeVersion: { status: "review", chunkCount: 2, version: 2 },
    });
    const insert = fixture.calls.find(({ sql }) =>
      sql.includes("INSERT INTO enterprise.knowledge_chunks")
    );
    expect(JSON.parse(String(insert?.values?.[1]))).toEqual([
      expect.objectContaining({ block_id: "b1", content_hash: expect.any(String) }),
      expect.objectContaining({ block_id: "b2", content_hash: expect.any(String) }),
    ]);
  });

  it("publishes only a reviewed version with chunks", async () => {
    const fixture = knowledgeFixture("publish");
    const repository = new EnterpriseKnowledgePostgresRepository(fixture.session);

    await expect(repository.publish({
      versionId: knowledgeVersionId,
      expectedVersion: 2,
      effectiveFrom: now,
      expiresAt: "2026-08-18T10:00:00.000Z",
      publishedAt: now,
    })).resolves.toMatchObject({
      status: "published",
      knowledgeVersion: { status: "published", chunkCount: 2, version: 3 },
    });
    expect(fixture.calls.some(({ sql }) =>
      sql.includes("UPDATE enterprise.knowledge_sources")
    )).toBe(true);
  });

  it("searches only the latest currently effective published version", async () => {
    const fixture = knowledgeFixture("search");
    const repository = new EnterpriseKnowledgePostgresRepository(fixture.session);

    await expect(repository.search({
      query: "退款",
      locale: "zh-CN",
      countryCode: "CN",
      productCode: "phone-pro",
      limit: 5,
      now,
    })).resolves.toEqual([expect.objectContaining({
      knowledgeVersionId,
      blockId: "b1",
      citation: `${knowledgeVersionId}:b1`,
    })]);
    const search = fixture.calls.at(-1)!;
    expect(search.sql).toContain("status = 'published'");
    expect(search.sql).toContain("effective_from <= $5");
    expect(search.sql).toContain("expires_at > $5");
    expect(search.sql).toContain("DISTINCT ON (source_id)");
  });
});

type Mode = "create" | "stage" | "publish" | "search";

function knowledgeFixture(mode: Mode) {
  const calls: Call[] = [];
  const context = createEnterpriseTenantContext({
    tenantId,
    actorUserId: "user_00000000-0000-4000-8000-000000000002",
    traceId: "trace-knowledge-1",
  });
  const query = async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values });
    let rows: Array<Record<string, unknown>> = [];
    if (mode === "create" && sql.includes("enterprise.knowledge_sources")) {
      rows = [{ id: sourceId }];
    } else if (mode === "create" && sql.includes("max(revision)")) {
      rows = [{ next_revision: "2" }];
    } else if (mode === "create" && sql.includes("INSERT INTO enterprise.knowledge_versions")) {
      rows = [versionRow({ revision: "2" })];
    } else if ((mode === "stage" || mode === "publish") &&
      sql.includes("FROM enterprise.knowledge_versions") && sql.includes("FOR UPDATE")) {
      rows = [versionRow(mode === "stage" ? {} : {
        status: "review", content_hash: "a".repeat(64), chunk_count: "2", version: "2",
      })];
    } else if (mode === "stage" && sql.includes("UPDATE enterprise.knowledge_versions")) {
      rows = [versionRow({
        status: "review", content_hash: String(values[1]),
        chunk_count: String(values[5]), version: "2",
      })];
    } else if (mode === "publish" && sql.includes("count(*)::text")) {
      rows = [{ count: "2" }];
    } else if (mode === "publish" && sql.includes("UPDATE enterprise.knowledge_versions")) {
      rows = [versionRow({
        status: "published", content_hash: "a".repeat(64), chunk_count: "2",
        effective_from: values[1], expires_at: values[2],
        published_at: values[4], version: "3",
      })];
    } else if (mode === "search" && sql.includes("WITH active_versions")) {
      rows = [{
        knowledge_version_id: knowledgeVersionId,
        source_id: sourceId,
        revision: "3",
        block_id: "b1",
        content: "退款申请需要订单编号。",
        content_hash: "b".repeat(64),
      }];
    }
    return { rows: rows as Row[] };
  };
  const session = {
    context, query, queryTenantRecord: query, queryCommunication: query,
    queryCommunicationMutation: query, queryWorkerDispatch: query,
  } satisfies EnterpriseTenantPostgresSession;
  return { calls, session };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: knowledgeVersionId,
    tenant_id: tenantId,
    source_id: sourceId,
    revision: "1",
    status: "draft",
    locale: "zh-CN",
    country_code: "CN",
    product_code: "phone-pro",
    content_hash: null,
    chunk_count: "0",
    effective_from: null,
    published_at: null,
    expires_at: null,
    created_at: now,
    version: "1",
    ...overrides,
  };
}

interface Call {
  sql: string;
  values: unknown[];
}
