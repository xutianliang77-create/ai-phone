import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  enterpriseRoleScopes,
  type AccountDto,
  type EnterpriseContextResponse,
  type EnterpriseMemberDto,
  type EnterpriseScope,
} from "@translation/contracts";
import { EnterpriseApiError, type EnterpriseApi } from "../api/enterprise-api.js";
import { AuthProvider } from "../auth/AuthContext.js";
import { MemoryStorage } from "../test/MemoryStorage.js";
import { fakeEnterpriseContentApi } from "../test/fakeEnterpriseContentApi.js";
import { MemberSettingsPage } from "./MemberSettingsPage.js";

describe("enterprise member and role settings", () => {
  it("shows real members and the shared role scope matrix to a read-only role", async () => {
    const api = fakeApi(["member:read"]);
    api.listMembers = vi.fn().mockResolvedValue({
      members: [member("member-a", "user-a", "auditor")],
    });

    renderPage(api);

    expect(await screen.findByRole("heading", { name: "成员目录" })).toBeVisible();
    expect(screen.getByText("当前角色只有 member:read，可查看成员和角色 scope，不能执行新增或编辑。"))
      .toBeVisible();
    expect(screen.queryByRole("button", { name: "添加成员" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑/ })).not.toBeInTheDocument();
    const auditorScopes = screen.getByLabelText("审计员 scopes");
    expect(within(auditorScopes).getAllByTitle(/.+/)).toHaveLength(
      enterpriseRoleScopes.auditor.length,
    );
  });

  it("adds an existing account with the selected server role", async () => {
    const api = fakeApi(["member:read", "member:write"]);
    api.listMembers = vi.fn().mockResolvedValue({ members: [owner()] });
    api.createMember = vi.fn().mockResolvedValue({
      member: member("member-b", "user-b", "support_agent"),
    });
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: "添加成员" }));
    await user.type(screen.getByLabelText("账号 ID"), " user-b ");
    await user.selectOptions(screen.getByLabelText("成员角色"), "support_agent");
    await user.click(screen.getByRole("button", { name: "确认添加" }));

    await waitFor(() => expect(api.createMember).toHaveBeenCalledWith(
      expect.objectContaining({ token: "token-a", tenantId: "tenant-a" }),
      { userId: "user-b", role: "support_agent" },
    ));
    expect(await screen.findByText("已添加账号 user-b，当前角色为客服坐席。"))
      .toBeVisible();
    expect(screen.getByText("user-b")).toBeVisible();
    expect(screen.queryByText(/不会发送短信、邮件或外部 Provider 邀请/))
      .not.toBeInTheDocument();
  });

  it("updates another member role and status from the returned server record", async () => {
    const api = fakeApi(["member:read", "member:write"]);
    api.listMembers = vi.fn().mockResolvedValue({
      members: [owner(), member("member-b", "user-b", "support_agent")],
    });
    api.updateMember = vi.fn().mockResolvedValue({
      member: member("member-b", "user-b", "support_manager", "suspended", 2),
    });
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: "编辑 user-b" }));
    await user.selectOptions(screen.getByLabelText("成员角色"), "support_manager");
    await user.selectOptions(screen.getByLabelText("成员状态"), "suspended");
    await user.click(screen.getByRole("button", { name: "保存变更" }));

    await waitFor(() => expect(api.updateMember).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a" }),
      "member-b",
      { role: "support_manager", status: "suspended" },
    ));
    expect(await screen.findByText("已保存账号 user-b 的角色与状态。"))
      .toBeVisible();
    const updatedRow = screen.getByRole("row", { name: /user-b/ });
    expect(within(updatedRow).getByText("客服主管")).toBeVisible();
    expect(within(updatedRow).getByText("已停用")).toBeVisible();
    expect(within(updatedRow).getByText("版本 2")).toBeVisible();
  });

  it.each([
    [403, "enterprise_scope_denied", "无权访问", /member:read/],
    [503, "enterprise_postgres_required", "尚未就绪", /未回退到 SQLite\/JSON/],
  ])("renders list failure %s as an explicit non-fallback state", async (
    status,
    code,
    heading,
    description,
  ) => {
    const api = fakeApi(["member:read"]);
    api.listMembers = vi.fn().mockRejectedValue(
      new EnterpriseApiError(status, code, "Rejected", "trace-member"),
    );

    renderPage(api);

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByText(description)).toBeVisible();
    expect(screen.getByText("trace-member")).toBeVisible();
    expect(screen.queryByText("成员目录")).not.toBeInTheDocument();
  });

  it("keeps a rejected duplicate visible as a conflict without changing the list", async () => {
    const api = fakeApi(["member:read", "member:write"]);
    api.listMembers = vi.fn().mockResolvedValue({ members: [owner()] });
    api.createMember = vi.fn().mockRejectedValue(
      new EnterpriseApiError(409, "member_already_exists", "Already exists"),
    );
    const user = userEvent.setup();
    renderPage(api);

    await user.click(await screen.findByRole("button", { name: "添加成员" }));
    await user.type(screen.getByLabelText("账号 ID"), "user-a");
    await user.click(screen.getByRole("button", { name: "确认添加" }));

    expect(await screen.findByText("该账号已属于当前企业，未重复创建成员关系。"))
      .toBeVisible();
    expect(screen.getByRole("heading", { name: "成员已存在" })).toBeVisible();
    expect(api.createMember).toHaveBeenCalledOnce();
    expect(screen.getAllByText("user-a")).toHaveLength(1);
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
      <MemberSettingsPage />
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

function member(
  id: string,
  userId: string,
  role: EnterpriseMemberDto["role"],
  status: EnterpriseMemberDto["status"] = "active",
  version = 1,
): EnterpriseMemberDto {
  const now = "2026-07-19T00:00:00Z";
  return {
    id, tenantId: "tenant-a", userId, role, status, joinedAt: now,
    createdAt: now, updatedAt: now, version,
  };
}

function owner() {
  return member("member-owner", "user-a", "owner");
}

function membership() {
  const now = "2026-07-19T00:00:00Z";
  return {
    tenant: {
      id: "tenant-a", name: "Tenant A", status: "active" as const, homeRegion: "cn",
      cellId: "cn-cell-01", planCode: "enterprise_trial", dataRetentionDays: 30,
      createdAt: now, updatedAt: now, version: 7,
    },
    member: owner(),
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
