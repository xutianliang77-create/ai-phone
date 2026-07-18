import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  legacyEnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";
import {
  createTenantRouteService,
  encodeTenantRouteDocument,
} from "./enterprise-tenant-route.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const sourceId = "00000000-0000-4000-8000-000000000021";
const knowledgeVersionId = "00000000-0000-4000-8000-000000000022";
const now = "2026-07-18T10:00:00.000Z";

describe("enterprise knowledge routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    seed();
  });

  it("runs source, version, chunk, publish and scoped search flows", async () => {
    const runtime = {
      ...legacyEnterpriseRepositoryRuntime,
      createKnowledgeSource: vi.fn(async () => ({
        status: "created" as const, source: sourceRecord(),
      })),
      createKnowledgeVersion: vi.fn(async () => ({
        status: "created" as const, knowledgeVersion: versionRecord(),
      })),
      stageKnowledgeChunks: vi.fn(async () => ({
        status: "staged" as const,
        knowledgeVersion: versionRecord({ status: "review", chunkCount: 1, version: 2 }),
      })),
      publishKnowledgeVersion: vi.fn(async () => ({
        status: "published" as const,
        knowledgeVersion: versionRecord({
          status: "published", chunkCount: 1, version: 3,
          contentHash: "a".repeat(64), effectiveFrom: now, publishedAt: now,
        }),
      })),
      searchKnowledge: vi.fn(async (input) => ({
        status: "ready" as const,
        results: [{
          knowledgeVersionId, sourceId, revision: 1, blockId: "b1",
          content: "退款申请需要订单编号。", contentHash: "b".repeat(64),
          citation: `${knowledgeVersionId}:b1`,
        }],
      })),
    };
    const app = await buildApp({
      tenantRouteService: routeService,
      enterpriseRepositoryRuntime: runtime,
    });

    const source = await app.inject({
      method: "POST", url: "/enterprise/v1/knowledge/sources",
      headers: headers("manager-token"),
      payload: { name: "退款政策", sourceType: "upload" },
    });
    const version = await app.inject({
      method: "POST", url: `/enterprise/v1/knowledge/sources/${sourceId}/versions`,
      headers: headers("manager-token"),
      payload: { locale: "zh-CN", countryCode: "CN", productCode: "phone-pro" },
    });
    const chunks = await app.inject({
      method: "PUT", url: `/enterprise/v1/knowledge/versions/${knowledgeVersionId}/chunks`,
      headers: headers("manager-token"),
      payload: {
        expectedVersion: 1,
        chunks: [{ blockId: "b1", content: "退款申请需要订单编号。" }],
      },
    });
    const published = await app.inject({
      method: "POST", url: `/enterprise/v1/knowledge/versions/${knowledgeVersionId}/publish`,
      headers: headers("manager-token"), payload: { expectedVersion: 2 },
    });
    const search = await app.inject({
      method: "POST", url: "/enterprise/v1/knowledge/search",
      headers: headers("agent-token"),
      payload: {
        query: "退款", locale: "zh-CN", countryCode: "CN", productCode: "phone-pro",
      },
    });
    await app.close();

    expect(source.statusCode).toBe(201);
    expect(version.statusCode).toBe(201);
    expect(chunks.statusCode).toBe(200);
    expect(published.statusCode).toBe(200);
    expect(search.statusCode).toBe(200);
    expect(search.json().results[0].citation).toBe(`${knowledgeVersionId}:b1`);
    expect(runtime.searchKnowledge).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ tenantId }),
      search: expect.objectContaining({ countryCode: "CN", productCode: "phone-pro" }),
    }));
  });

  it("rejects missing scope, tenant spoofing and legacy persistence", async () => {
    const createKnowledgeSource = vi.fn(async () => ({
      status: "created" as const, source: sourceRecord(),
    }));
    const createKnowledgeVersion = vi.fn(async () => ({
      status: "created" as const, knowledgeVersion: versionRecord(),
    }));
    const app = await buildApp({
      tenantRouteService: routeService,
      enterpriseRepositoryRuntime: {
        ...legacyEnterpriseRepositoryRuntime,
        createKnowledgeSource,
        createKnowledgeVersion,
      },
    });
    const denied = await app.inject({
      method: "POST", url: "/enterprise/v1/knowledge/sources",
      headers: headers("agent-token"),
      payload: { name: "Denied", sourceType: "text" },
    });
    const spoofed = await app.inject({
      method: "POST", url: "/enterprise/v1/knowledge/sources",
      headers: headers("manager-token"),
      payload: {
        tenantId: "00000000-0000-4000-8000-000000000099",
        name: "Spoofed", sourceType: "text",
      },
    });
    const invalidSourceId = await app.inject({
      method: "POST", url: "/enterprise/v1/knowledge/sources/not-a-uuid/versions",
      headers: headers("manager-token"),
      payload: { locale: "zh-CN", countryCode: "CN", productCode: "phone-pro" },
    });
    await app.close();

    const legacy = await buildApp({ tenantRouteService: routeService });
    const unavailable = await legacy.inject({
      method: "POST", url: "/enterprise/v1/knowledge/sources",
      headers: headers("manager-token"),
      payload: { name: "No database", sourceType: "text" },
    });
    await legacy.close();

    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("enterprise_scope_denied");
    expect(spoofed.statusCode).toBe(409);
    expect(spoofed.json().error.code).toBe("tenant_context_mismatch");
    expect(invalidSourceId.statusCode).toBe(400);
    expect(invalidSourceId.json().error.code).toBe("invalid_knowledge_source_id");
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("enterprise_postgres_required");
    expect(createKnowledgeSource).not.toHaveBeenCalled();
    expect(createKnowledgeVersion).not.toHaveBeenCalled();
  });
});

function sourceRecord() {
  return {
    id: sourceId, tenantId, name: "退款政策", sourceType: "upload" as const,
    status: "active" as const,
    createdBy: "user_00000000-0000-4000-8000-000000000002",
    createdAt: now, updatedAt: now, version: 1,
  };
}

function versionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: knowledgeVersionId, tenantId, sourceId, revision: 1,
    status: "draft" as const, locale: "zh-CN", countryCode: "CN",
    productCode: "phone-pro", chunkCount: 0, createdAt: now, version: 1,
    ...overrides,
  };
}

function headers(token: string) {
  const route = routeService.issue({
    tenantId, homeRegion: "cn", cellId: "cn-cell-01", routeEpoch: 1,
  });
  if (route.status !== "ready") throw new Error("route not ready");
  return {
    authorization: `Bearer ${token}`,
    "x-tenant-id": tenantId,
    "x-enterprise-route-document": encodeTenantRouteDocument(route.document),
  };
}

function seed() {
  const store = getStoreSnapshot();
  for (const [id, token, role] of [
    ["manager-user", "manager-token", "support_manager"],
    ["agent-user", "agent-token", "support_agent"],
  ] as const) {
    store.accounts.push({
      id, phoneHash: `hash-${id}`, phoneMasked: "138****0000",
      status: "active", createdAt: now, updatedAt: now,
    });
    store.authSessions.push({
      token, userId: id, createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    store.enterpriseMembers.push({
      id: `${id}-membership`, tenantId, userId: id, role, status: "active",
      createdAt: now, updatedAt: now, version: 1,
    });
  }
  store.enterpriseTenants.push({
    id: tenantId, name: "Tenant A", status: "active", homeRegion: "cn",
    cellId: "cn-cell-01", planCode: "enterprise_trial", dataRetentionDays: 30,
    createdAt: now, updatedAt: now, version: 1,
  });
}

const routeService = createTenantRouteService({
  signingSecret: "enterprise-knowledge-route-test-secret-32-bytes",
  publicRoutes: {
    "cn-cell-01": {
      homeRegion: "cn", apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
    },
  },
});
