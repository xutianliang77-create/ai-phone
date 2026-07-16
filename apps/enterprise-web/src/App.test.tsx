import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountDto,
  EnterpriseContextResponse,
  EnterpriseMembershipDto,
} from "@translation/contracts";
import { EnterpriseApiError, type EnterpriseApi } from "./api/enterprise-api.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { MemoryStorage } from "./test/MemoryStorage.js";
import { AppRoutes } from "./App.js";

describe("enterprise application entry", () => {
  it("keeps a failed login outside the enterprise shell", async () => {
    const api = fakeApi();
    api.login = vi.fn().mockRejectedValue(
      new EnterpriseApiError(401, "invalid_code", "Phone login failed"),
    );
    const user = userEvent.setup();
    renderApp(api, new MemoryStorage(), ["/"]);

    await user.type(await screen.findByLabelText("手机号"), "13800138000");
    await user.type(screen.getByLabelText("验证码"), "000000");
    await user.click(screen.getByRole("button", { name: "登录企业工作台" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("验证码无效或已过期");
    expect(screen.queryByRole("navigation", { name: "企业版主导航" })).not.toBeInTheDocument();
  });

  it("restores a valid session and enters the selected tenant", async () => {
    const api = fakeApi();
    const storage = new MemoryStorage();
    writeSession(storage, "tenant-a");
    renderApp(api, storage, ["/"]);

    expect(await screen.findByRole("navigation", { name: "企业版主导航" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "工作台" })).toBeVisible();
    expect(screen.getByText("Tenant A")).toBeVisible();
  });

  it("requires an explicit choice when the account has multiple tenants", async () => {
    const api = fakeApi([membership("tenant-a", "Tenant A"), membership("tenant-b", "Tenant B")]);
    const storage = new MemoryStorage();
    writeSession(storage);
    const user = userEvent.setup();
    renderApp(api, storage, ["/"]);

    expect(await screen.findByRole("heading", { name: "进入一个企业工作区" })).toBeVisible();
    await user.click(screen.getByLabelText(/Tenant B/));
    await user.click(screen.getByRole("button", { name: "进入所选企业" }));

    await waitFor(() => expect(api.getContext).toHaveBeenCalledWith("token-a", "tenant-b"));
    expect(await screen.findByRole("heading", { name: "工作台" })).toBeVisible();
  });
});

function renderApp(api: EnterpriseApi, storage: MemoryStorage, entries: string[]) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <AuthProvider api={api} storage={storage}>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fakeApi(tenants = [membership("tenant-a", "Tenant A")]): EnterpriseApi {
  return {
    requestCode: vi.fn(),
    login: vi.fn(),
    listTenants: vi.fn().mockResolvedValue({ tenants }),
    getContext: vi.fn().mockImplementation(async (_token: string, tenantId: string) =>
      context(tenants.find(({ tenant }) => tenant.id === tenantId) ?? tenants[0]!)),
    logout: vi.fn(),
  };
}

function membership(id: string, name: string): EnterpriseMembershipDto {
  const now = "2026-07-16T00:00:00Z";
  return {
    tenant: {
      id,
      name,
      status: "active",
      homeRegion: "cn",
      planCode: "enterprise_trial",
      dataRetentionDays: 30,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    member: {
      id: `member-${id}`,
      tenantId: id,
      userId: "user-a",
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  };
}

function context(value: EnterpriseMembershipDto): EnterpriseContextResponse {
  return { ...value, scopes: ["tenant:read", "meeting:read", "member:read"] };
}

function writeSession(storage: MemoryStorage, tenantId?: string) {
  const account: AccountDto = {
    id: "user-a",
    phoneMasked: "138****0000",
    status: "active",
    createdAt: "2026-07-16T00:00:00Z",
    updatedAt: "2026-07-16T00:00:00Z",
  };
  storage.setItem("wujie.enterprise.session.v1", JSON.stringify({
    token: "token-a",
    expiresAt: "2099-07-17T00:00:00Z",
    tenantId,
    account,
  }));
}
