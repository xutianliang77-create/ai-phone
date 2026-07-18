import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountDto,
  EnterpriseContextResponse,
  EnterpriseKnowledgeVersionDto,
  EnterpriseScope,
} from "@translation/contracts";
import { EnterpriseApiError, type EnterpriseApi } from "../api/enterprise-api.js";
import { AuthProvider } from "../auth/AuthContext.js";
import { MemoryStorage } from "../test/MemoryStorage.js";
import { fakeEnterpriseContentApi } from "../test/fakeEnterpriseContentApi.js";
import { KnowledgePage } from "./KnowledgePage.js";

describe("enterprise knowledge and terminology page", () => {
  it("shows server lifecycle truth but no write controls to a read-only role", async () => {
    const api = fakeApi(["knowledge:read"]);
    api.listKnowledgeSources = vi.fn().mockResolvedValue({ sources: [knowledgeSource()] });
    api.listKnowledgeVersions = vi.fn().mockResolvedValue({
      knowledgeVersions: [knowledgeVersion("published"), knowledgeVersion("expired", 2)],
    });

    renderPage(api);

    expect(await screen.findByText("已发布，只读快照")).toBeVisible();
    expect(screen.getByText("已过期，不参与运行时解析")).toBeVisible();
    expect(screen.queryByRole("button", { name: /新建知识源/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /发布修订/ })).not.toBeInTheDocument();
  });

  it("stages and publishes with the selected tenant route and exact server version", async () => {
    const api = fakeApi(["knowledge:read", "knowledge:publish"]);
    api.listKnowledgeSources = vi.fn().mockResolvedValue({ sources: [knowledgeSource()] });
    api.listKnowledgeVersions = vi.fn().mockResolvedValue({
      knowledgeVersions: [knowledgeVersion("draft")],
    });
    api.stageKnowledgeVersion = vi.fn().mockResolvedValue({
      knowledgeVersion: knowledgeVersion("review", 1, 2),
    });
    api.publishKnowledgeVersion = vi.fn().mockResolvedValue({
      knowledgeVersion: knowledgeVersion("published", 1, 3),
    });
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: /提交内容评审/ }));
    await user.type(screen.getByLabelText(/知识正文/), "第一段\n\n第二段");
    await user.click(screen.getByRole("button", { name: "提交评审" }));

    await waitFor(() => expect(api.stageKnowledgeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ token: "token-a", tenantId: "tenant-a" }),
      "version-a",
      {
        expectedVersion: 1,
        chunks: [
          { blockId: "block-001", content: "第一段" },
          { blockId: "block-002", content: "第二段" },
        ],
      },
    ));
    await user.click(await screen.findByRole("button", { name: /发布修订 1/ }));
    await user.click(screen.getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(api.publishKnowledgeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a" }),
      "version-a",
      { expectedVersion: 2 },
    ));
    expect(await screen.findByText("已发布，只读快照")).toBeVisible();
  });

  it("reports PostgreSQL runtime absence without local fallback data", async () => {
    const api = fakeApi(["knowledge:read"]);
    api.listKnowledgeSources = vi.fn().mockRejectedValue(
      new EnterpriseApiError(503, "enterprise_postgres_required", "PostgreSQL required"),
    );

    renderPage(api);

    expect(await screen.findByRole("heading", { name: "尚未就绪" })).toBeVisible();
    expect(screen.getByText(/未回退到 SQLite\/JSON/)).toBeVisible();
  });

  it.each([
    [403, "scope_denied", "无权访问"],
    [409, "version_conflict", "版本冲突"],
  ])("maps API %s (%s) to an explicit page state", async (status, code, heading) => {
    const api = fakeApi(["knowledge:read"]);
    api.listKnowledgeSources = vi.fn().mockRejectedValue(
      new EnterpriseApiError(status, code, "Rejected"),
    );

    renderPage(api);

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
  });

  it("renders term scopes and script controls from their server versions", async () => {
    const api = fakeApi(["knowledge:read"]);
    api.listTermPacks = vi.fn().mockResolvedValue({ termPacks: [termPack()] });
    api.listTermPackVersions = vi.fn().mockResolvedValue({ termPackVersions: [termVersion()] });
    api.listScriptTemplates = vi.fn().mockResolvedValue({ scriptTemplates: [scriptTemplate()] });
    api.listScriptTemplateVersions = vi.fn().mockResolvedValue({
      scriptTemplateVersions: [scriptVersion()],
    });
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole("tab", { name: /术语包/ }));
    expect(await screen.findByText("1 个术语 · ASR / 翻译 / Agent")).toBeVisible();
    expect(screen.getByText("使用范围：support")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /话术模板/ }));
    expect(await screen.findByText("2 必说 · 1 禁语")).toBeVisible();
    expect(screen.getByText("support · active")).toBeVisible();
  });
});

function renderPage(api: EnterpriseApi) {
  const storage = new MemoryStorage();
  storage.setItem("wujie.enterprise.session.v1", JSON.stringify({
    token: "token-a",
    expiresAt: "2099-07-20T00:00:00Z",
    tenantId: "tenant-a",
    account: account(),
  }));
  return render(
    <AuthProvider api={api} storage={storage}>
      <KnowledgePage />
    </AuthProvider>,
  );
}

function fakeApi(scopes: EnterpriseScope[]): EnterpriseApi {
  return {
    ...fakeEnterpriseContentApi(),
    requestCode: vi.fn(),
    login: vi.fn(),
    listTenants: vi.fn().mockResolvedValue({ tenants: [membership()] }),
    getTenantRoute: vi.fn().mockResolvedValue(routeDocument()),
    getProviderCapabilities: vi.fn().mockResolvedValue({ capabilities: [] }),
    getContext: vi.fn().mockResolvedValue({ ...membership(), scopes } satisfies EnterpriseContextResponse),
    getTenantJob: vi.fn(),
    logout: vi.fn(),
  };
}

function knowledgeSource() {
  return {
    id: "source-a", tenantId: "tenant-a", name: "产品知识", sourceType: "text" as const,
    status: "active" as const, createdBy: "user-a", createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z", version: 1,
  };
}

function knowledgeVersion(
  status: EnterpriseKnowledgeVersionDto["status"],
  revision = 1,
  version = 1,
): EnterpriseKnowledgeVersionDto {
  return {
    id: revision === 1 ? "version-a" : `version-${revision}`,
    tenantId: "tenant-a", sourceId: "source-a", revision, status,
    locale: "zh-CN", countryCode: "CN", productCode: "product-cn",
    ...(status === "draft" ? {} : { contentHash: "a".repeat(64) }),
    chunkCount: status === "draft" ? 0 : 2,
    ...(status === "published" || status === "expired" ? {
      effectiveFrom: "2026-07-19T00:00:00Z", publishedAt: "2026-07-19T00:00:00Z",
    } : {}),
    ...(status === "expired" ? { expiresAt: "2026-07-19T01:00:00Z" } : {}),
    createdAt: "2026-07-19T00:00:00Z", version,
  };
}

function termPack() {
  return {
    id: "term-pack-a", tenantId: "tenant-a", name: "客服术语", status: "active" as const,
    createdBy: "user-a", createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z", version: 1,
  };
}

function termVersion() {
  return {
    id: "term-version-a", tenantId: "tenant-a", termPackId: "term-pack-a", revision: 1,
    status: "review" as const, sourceLocale: "zh-CN", targetLocale: "en-US",
    countryCode: "CN", productCode: "product-cn", usageScope: "support" as const,
    contentHash: "b".repeat(64), termCount: 1, createdAt: "2026-07-19T00:00:00Z", version: 2,
  };
}

function scriptTemplate() {
  return {
    id: "script-a", tenantId: "tenant-a", name: "客服话术", purpose: "support" as const,
    status: "active" as const, createdBy: "user-a", createdAt: "2026-07-19T00:00:00Z",
    updatedAt: "2026-07-19T00:00:00Z", version: 1,
  };
}

function scriptVersion() {
  return {
    id: "script-version-a", tenantId: "tenant-a", scriptTemplateId: "script-a", revision: 1,
    status: "published" as const, locale: "zh-CN", countryCode: "CN",
    productCode: "product-cn", contentHash: "c".repeat(64), requiredPhraseCount: 2,
    prohibitedPhraseCount: 1, variableCount: 1, effectiveFrom: "2026-07-19T00:00:00Z",
    publishedAt: "2026-07-19T00:00:00Z", createdAt: "2026-07-19T00:00:00Z", version: 3,
  };
}

function membership() {
  const now = "2026-07-19T00:00:00Z";
  return {
    tenant: {
      id: "tenant-a", name: "Tenant A", status: "active" as const, homeRegion: "cn",
      cellId: "cn-cell-01", planCode: "enterprise_trial", dataRetentionDays: 30,
      createdAt: now, updatedAt: now, version: 7,
    },
    member: {
      id: "member-a", tenantId: "tenant-a", userId: "user-a", role: "owner" as const,
      status: "active" as const, createdAt: now, updatedAt: now, version: 1,
    },
  };
}

function routeDocument() {
  return {
    tenantId: "tenant-a", homeRegion: "cn", cellId: "cn-cell-01", routeEpoch: 7,
    apiBaseUrl: "https://api-cn.enterprise.example", rtcUrl: "wss://rtc-cn.enterprise.example",
    issuedAt: "2026-07-19T00:00:00Z", expiresAt: "2099-07-19T00:05:00Z",
    signature: "signed-route-document",
  };
}

function account(): AccountDto {
  return {
    id: "user-a", phoneMasked: "138****0000", status: "active",
    createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z",
  };
}
