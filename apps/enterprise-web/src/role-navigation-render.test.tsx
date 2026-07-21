import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  enterpriseMemberRoles,
  enterpriseRoleScopes,
  type AccountDto,
  type EnterpriseContextResponse,
  type EnterpriseMemberRole,
  type EnterpriseMembershipDto,
} from "@translation/contracts";
import { AppRoutes } from "./App.js";
import type { EnterpriseApi } from "./api/enterprise-api.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { MemoryStorage } from "./test/MemoryStorage.js";
import { fakeEnterpriseContentApi } from "./test/fakeEnterpriseContentApi.js";

describe("enterprise role navigation render matrix", () => {
  it.each(enterpriseMemberRoles)("renders only discovered links for %s", async (role) => {
    renderRole(role, "/");

    const navigation = await screen.findByRole("navigation", { name: "企业版主导航" });
    const hrefs = Array.from(navigation.querySelectorAll("a"))
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(expectedRoutes[role]);
  });

  it("keeps a hidden nested route forbidden when opened directly", async () => {
    renderRole("marketing_member", "/support/session-a");

    expect(await screen.findByRole("heading", { name: "坐席工作台" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "无权访问" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /AI 客服/ })).not.toBeInTheDocument();
  });

  it("opens the first tenant-readable settings page without executing member reads", async () => {
    const api = renderRole("marketing_member", "/settings");

    expect(await screen.findByRole("heading", { name: "区域与数据" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /成员与角色/ })).not.toBeInTheDocument();
    expect(api.listMembers).not.toHaveBeenCalled();
  });

  it("guards a direct billing settings URL before calling billing APIs", async () => {
    const api = renderRole("marketing_member", "/settings/billing");

    expect(await screen.findByRole("heading", { name: "企业设置" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "无权访问" })).toBeVisible();
    expect(api.getBillingEntitlements).not.toHaveBeenCalled();
  });

  it("routes an authorized settings URL to the real member directory", async () => {
    const api = renderRole("owner", "/settings");

    expect(await screen.findByRole("heading", { name: "成员与角色" })).toBeVisible();
    expect(await screen.findByRole("heading", { name: "暂无数据" })).toBeVisible();
    expect(api.listMembers).toHaveBeenCalledOnce();
  });
});

const expectedRoutes: Record<EnterpriseMemberRole, readonly string[]> = {
  owner: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  admin: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  marketing_manager: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics", "/settings"],
  marketing_member: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics", "/settings"],
  support_manager: ["/", "/support", "/contacts", "/knowledge", "/analytics", "/settings"],
  support_agent: ["/", "/support", "/contacts", "/knowledge", "/settings"],
  meeting_host: ["/", "/meetings", "/analytics", "/settings"],
  member: ["/", "/meetings", "/analytics", "/settings"],
  auditor: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
};

function renderRole(role: EnterpriseMemberRole, path: string) {
  const api = fakeApi(role);
  const storage = new MemoryStorage();
  storage.setItem("wujie.enterprise.session.v1", JSON.stringify({
    token: "token-a",
    expiresAt: "2099-07-17T00:00:00Z",
    tenantId: "tenant-a",
    account: account(),
  }));
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider api={api} storage={storage}>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
  return api;
}

function fakeApi(role: EnterpriseMemberRole): EnterpriseApi {
  const value = membership(role);
  return {
    ...fakeEnterpriseContentApi(),
    requestCode: vi.fn(),
    login: vi.fn(),
    listTenants: vi.fn().mockResolvedValue({ tenants: [value] }),
    getTenantRoute: vi.fn().mockResolvedValue({
      tenantId: "tenant-a",
      homeRegion: "cn",
      cellId: "cn-cell-01",
      routeEpoch: 7,
      apiBaseUrl: "https://api-cn.enterprise.example",
      rtcUrl: "wss://rtc-cn.enterprise.example",
      issuedAt: "2026-07-16T00:00:00Z",
      expiresAt: "2099-07-16T00:05:00Z",
      signature: "signed-route-document",
    }),
    getProviderCapabilities: vi.fn().mockResolvedValue({ capabilities: [] }),
    getContext: vi.fn().mockResolvedValue({
      ...value,
      scopes: enterpriseRoleScopes[role],
    } satisfies EnterpriseContextResponse),
    getTenantJob: vi.fn(),
    logout: vi.fn(),
  };
}

function membership(role: EnterpriseMemberRole): EnterpriseMembershipDto {
  const now = "2026-07-16T00:00:00Z";
  return {
    tenant: {
      id: "tenant-a", name: "Tenant A", status: "active", homeRegion: "cn",
      cellId: "cn-cell-01",
      planCode: "enterprise_trial", dataRetentionDays: 30,
      createdAt: now, updatedAt: now, version: 1,
    },
    member: {
      id: "member-a", tenantId: "tenant-a", userId: "user-a", role,
      status: "active", createdAt: now, updatedAt: now, version: 1,
    },
  };
}

function account(): AccountDto {
  return {
    id: "user-a", phoneMasked: "138****0000", status: "active",
    createdAt: "2026-07-16T00:00:00Z", updatedAt: "2026-07-16T00:00:00Z",
  };
}
