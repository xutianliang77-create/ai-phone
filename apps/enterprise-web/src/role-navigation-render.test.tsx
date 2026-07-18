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

    expect(await screen.findByRole("heading", { name: "AI 客服" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "无权访问" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /AI 客服/ })).not.toBeInTheDocument();
  });
});

const expectedRoutes: Record<EnterpriseMemberRole, readonly string[]> = {
  owner: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  admin: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
  marketing_manager: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics"],
  marketing_member: ["/", "/campaigns", "/contacts", "/knowledge", "/analytics"],
  support_manager: ["/", "/support", "/contacts", "/knowledge", "/analytics"],
  support_agent: ["/", "/support", "/contacts", "/knowledge", "/analytics"],
  meeting_host: ["/", "/meetings", "/analytics"],
  member: ["/", "/meetings", "/analytics"],
  auditor: ["/", "/campaigns", "/support", "/meetings", "/contacts", "/knowledge", "/analytics", "/audit", "/settings"],
};

function renderRole(role: EnterpriseMemberRole, path: string) {
  const storage = new MemoryStorage();
  storage.setItem("wujie.enterprise.session.v1", JSON.stringify({
    token: "token-a",
    expiresAt: "2099-07-17T00:00:00Z",
    tenantId: "tenant-a",
    account: account(),
  }));
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider api={fakeApi(role)} storage={storage}>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
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
