import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { createEnterpriseRuntimeContext } from "./enterprise-terminology.js";
import { legacyEnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import {
  createTenantRouteService,
  encodeTenantRouteDocument,
} from "./enterprise-tenant-route.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const packId = "00000000-0000-4000-8000-000000000031";
const packVersionId = "00000000-0000-4000-8000-000000000032";
const templateId = "00000000-0000-4000-8000-000000000033";
const templateVersionId = "00000000-0000-4000-8000-000000000034";
const now = "2026-07-18T10:00:00.000Z";
const term = {
  termId: "wujie", sourceText: "无界AI", translatedText: "Wujie AI",
  aliases: ["无界"], caseSensitive: false, protected: true,
};

describe("enterprise terminology routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    seed();
  });

  it("runs term/script publication and returns one engine version reference", async () => {
    const runtime = terminologyRuntime();
    const app = await buildApp({
      tenantRouteService: routeService, enterpriseRepositoryRuntime: runtime,
    });
    const pack = await inject(app, "POST", "/enterprise/v1/terminology/packs", {
      name: "品牌术语",
    });
    const packVersion = await inject(
      app, "POST", `/enterprise/v1/terminology/packs/${packId}/versions`, {
        sourceLocale: "zh-CN", targetLocale: "en-US", countryCode: "CN",
        productCode: "phone-pro", usageScope: "support",
      },
    );
    const packContent = await inject(
      app, "PUT", `/enterprise/v1/terminology/pack-versions/${packVersionId}/content`, {
        expectedVersion: 1, terms: [term],
      },
    );
    const packPublished = await inject(
      app, "POST", `/enterprise/v1/terminology/pack-versions/${packVersionId}/publish`, {
        expectedVersion: 2,
      },
    );
    const template = await inject(app, "POST", "/enterprise/v1/script-templates", {
      name: "客服开场", purpose: "support",
    });
    const templateVersion = await inject(
      app, "POST", `/enterprise/v1/script-templates/${templateId}/versions`, {
        locale: "en-US", countryCode: "CN", productCode: "phone-pro",
      },
    );
    const scriptContent = await inject(
      app, "PUT", `/enterprise/v1/script-template-versions/${templateVersionId}/content`, {
        expectedVersion: 1, promptText: "Follow the approved support script.",
        requiredPhrases: ["I am an AI assistant."], prohibitedPhrases: ["Guaranteed refund"],
        variables: ["customerName"],
      },
    );
    const scriptPublished = await inject(
      app, "POST", `/enterprise/v1/script-template-versions/${templateVersionId}/publish`, {
        expectedVersion: 2,
      },
    );
    const resolved = await app.inject({
      method: "POST", url: "/enterprise/v1/runtime-terminology/resolve",
      headers: headers("agent-token"), payload: {
        termPackId: packId, scriptTemplateId: templateId,
        sourceLocale: "zh-CN", targetLocale: "en-US", countryCode: "CN",
        productCode: "phone-pro", purpose: "support",
      },
    });
    await app.close();

    for (const response of [
      pack, packVersion, packContent, packPublished,
      template, templateVersion, scriptContent, scriptPublished,
    ]) expect(response.statusCode).toBeLessThan(300);
    expect(resolved.statusCode).toBe(200);
    const context = resolved.json().runtimeContext;
    expect(new Set([
      context.termPackVersionId, context.asr.termPackVersionId,
      context.translation.termPackVersionId, context.llm.termPackVersionId,
    ])).toEqual(new Set([packVersionId]));
    expect(context.llm.scriptTemplateVersionId).toBe(templateVersionId);
  });

  it("rejects missing publish scope, tenant spoofing, bad IDs and legacy storage", async () => {
    const runtime = terminologyRuntime();
    const app = await buildApp({
      tenantRouteService: routeService, enterpriseRepositoryRuntime: runtime,
    });
    const denied = await app.inject({
      method: "POST", url: "/enterprise/v1/terminology/packs",
      headers: headers("agent-token"), payload: { name: "Denied" },
    });
    const spoofed = await app.inject({
      method: "POST", url: "/enterprise/v1/script-templates",
      headers: headers("manager-token"), payload: {
        tenantId: "00000000-0000-4000-8000-000000000099",
        name: "Spoofed", purpose: "support",
      },
    });
    const invalid = await app.inject({
      method: "POST", url: "/enterprise/v1/terminology/packs/not-a-uuid/versions",
      headers: headers("manager-token"), payload: {
        sourceLocale: "zh-CN", targetLocale: "en-US", countryCode: "CN",
        productCode: "phone-pro", usageScope: "support",
      },
    });
    await app.close();

    const legacy = await buildApp({ tenantRouteService: routeService });
    const unavailable = await legacy.inject({
      method: "POST", url: "/enterprise/v1/terminology/packs",
      headers: headers("manager-token"), payload: { name: "No storage" },
    });
    await legacy.close();

    expect(denied.statusCode).toBe(403);
    expect(spoofed.statusCode).toBe(409);
    expect(invalid.statusCode).toBe(400);
    expect(unavailable.statusCode).toBe(503);
    expect(runtime.createTermPack).toHaveBeenCalledTimes(0);
    expect(runtime.createScriptTemplate).toHaveBeenCalledTimes(0);
  });
});

function terminologyRuntime() {
  return {
    ...legacyEnterpriseRepositoryRuntime,
    createTermPack: vi.fn(async () => ({ status: "created" as const, termPack: packRecord() })),
    createTermPackVersion: vi.fn(async () => ({
      status: "created" as const, termPackVersion: packVersionRecord(),
    })),
    stageTermPackVersion: vi.fn(async () => ({
      status: "staged" as const,
      termPackVersion: packVersionRecord({ status: "review", termCount: 1, version: 2 }),
    })),
    publishTermPackVersion: vi.fn(async () => ({
      status: "published" as const,
      termPackVersion: packVersionRecord({
        status: "published", termCount: 1, version: 3,
        contentHash: "a".repeat(64), effectiveFrom: now, publishedAt: now,
      }),
    })),
    createScriptTemplate: vi.fn(async () => ({
      status: "created" as const, scriptTemplate: templateRecord(),
    })),
    createScriptTemplateVersion: vi.fn(async () => ({
      status: "created" as const, scriptTemplateVersion: templateVersionRecord(),
    })),
    stageScriptTemplateVersion: vi.fn(async () => ({
      status: "staged" as const,
      scriptTemplateVersion: templateVersionRecord({ status: "review", version: 2 }),
    })),
    publishScriptTemplateVersion: vi.fn(async () => ({
      status: "published" as const,
      scriptTemplateVersion: templateVersionRecord({
        status: "published", version: 3, contentHash: "b".repeat(64),
        effectiveFrom: now, publishedAt: now,
      }),
    })),
    resolveTerminologyContext: vi.fn(async () => ({
      status: "ready" as const,
      runtimeContext: createEnterpriseRuntimeContext({
        termPackVersionId: packVersionId, termContentHash: "a".repeat(64), terms: [term],
        scriptTemplateVersionId: templateVersionId, scriptContentHash: "b".repeat(64),
        script: {
          promptText: "Follow the approved support script.",
          requiredPhrases: ["I am an AI assistant."],
          prohibitedPhrases: ["Guaranteed refund"], variables: ["customerName"],
        },
      }),
    })),
  };
}

function packRecord() {
  return {
    id: packId, tenantId, name: "品牌术语", status: "active" as const,
    createdBy: "user_00000000-0000-4000-8000-000000000002",
    createdAt: now, updatedAt: now, version: 1,
  };
}
function packVersionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: packVersionId, tenantId, termPackId: packId, revision: 1,
    status: "draft" as const, sourceLocale: "zh-CN", targetLocale: "en-US",
    countryCode: "CN", productCode: "phone-pro", usageScope: "support" as const,
    termCount: 0, createdAt: now, version: 1, ...overrides,
  };
}
function templateRecord() {
  return {
    id: templateId, tenantId, name: "客服开场", purpose: "support" as const,
    status: "active" as const,
    createdBy: "user_00000000-0000-4000-8000-000000000002",
    createdAt: now, updatedAt: now, version: 1,
  };
}
function templateVersionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: templateVersionId, tenantId, scriptTemplateId: templateId, revision: 1,
    status: "draft" as const, locale: "en-US", countryCode: "CN",
    productCode: "phone-pro", requiredPhraseCount: 0, prohibitedPhraseCount: 0,
    variableCount: 0, createdAt: now, version: 1, ...overrides,
  };
}

function inject(app: Awaited<ReturnType<typeof buildApp>>, method: "POST" | "PUT", url: string, payload: object) {
  return app.inject({ method, url, headers: headers("manager-token"), payload });
}
function headers(token: string) {
  const route = routeService.issue({
    tenantId, homeRegion: "cn", cellId: "cn-cell-01", routeEpoch: 1,
  });
  if (route.status !== "ready") throw new Error("route not ready");
  return {
    authorization: `Bearer ${token}`, "x-tenant-id": tenantId,
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
  signingSecret: "enterprise-terminology-route-test-secret-32-bytes",
  publicRoutes: {
    "cn-cell-01": {
      homeRegion: "cn", apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
    },
  },
});
