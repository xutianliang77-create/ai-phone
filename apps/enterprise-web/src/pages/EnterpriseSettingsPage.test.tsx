import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AccountDto,
  EnterpriseBillingLifecycleStatusResponse,
  EnterpriseContextResponse,
  EnterpriseScope,
} from "@translation/contracts";
import { EnterpriseApiError, type EnterpriseApi } from "../api/enterprise-api.js";
import { AuthProvider } from "../auth/AuthContext.js";
import { MemoryStorage } from "../test/MemoryStorage.js";
import { fakeEnterpriseContentApi } from "../test/fakeEnterpriseContentApi.js";
import { EnterpriseSettingsPage } from "./EnterpriseSettingsPage.js";

describe("enterprise service settings", () => {
  it("renders region and route values as read-only truth without exposing the signature", async () => {
    renderPage("/settings/region", ["tenant:read"]);

    expect(await screen.findByRole("heading", { name: "区域与数据" })).toBeVisible();
    expect(screen.getByText("route epoch 7")).toBeVisible();
    expect(screen.getByText("api-cn.enterprise.example")).toBeVisible();
    expect(screen.queryByText("signed-route-document")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "区域迁移尚未开放" })).toBeVisible();
  });

  it("shows not-configured provider truth and never renders secret-shaped fields", async () => {
    const api = renderPage("/settings/providers", ["tenant:read"]);

    expect(await screen.findByText("未配置")).toBeVisible();
    expect(screen.getByText("provider_not_configured")).toBeVisible();
    expect(screen.getAllByText("unconfigured")).toHaveLength(2);
    expect(screen.getByText(/不接收或回显 API Key、Secret、Webhook URL/)).toBeVisible();
    expect(screen.queryByLabelText(/API Key|Secret|Webhook/)).not.toBeInTheDocument();
    await waitFor(() => expect(api.getProviderCapabilities).toHaveBeenCalledTimes(2));
  });

  it("keeps billing read-only and omits the billing contact subject for an auditor", async () => {
    const api = createApi(["tenant:read", "billing:read"]);
    api.getBillingEntitlements = vi.fn().mockResolvedValue(entitlements());
    renderWithApi("/settings/billing", api);

    expect(await screen.findByText("enterprise_growth")).toBeVisible();
    expect(screen.getByText("当前角色只有 billing:read，不能变更订阅。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "提交变更" })).not.toBeInTheDocument();
    expect(screen.queryByText("private-contact-subject")).not.toBeInTheDocument();
  });

  it("reuses the subscription idempotency key after a conflict and replaces only server truth", async () => {
    const api = createApi(["tenant:read", "billing:read", "billing:write"]);
    api.getBillingEntitlements = vi.fn().mockResolvedValue(entitlements());
    api.changeSubscription = vi.fn()
      .mockRejectedValueOnce(new EnterpriseApiError(409, "idempotency_conflict", "Conflict"))
      .mockResolvedValueOnce({
        ...entitlements(),
        subscription: { ...entitlements().subscription, seats: 24, version: 4 },
      });
    const user = userEvent.setup();
    renderWithApi("/settings/billing", api);

    await screen.findByRole("button", { name: "提交变更" });
    const seats = screen.getByLabelText("席位数");
    await user.clear(seats);
    await user.type(seats, "24");
    await user.click(screen.getByRole("button", { name: "提交变更" }));
    expect(await screen.findByText(/同一幂等键对应了不同请求/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "提交变更" }));

    await waitFor(() => expect(api.changeSubscription).toHaveBeenCalledTimes(2));
    const first = vi.mocked(api.changeSubscription).mock.calls[0]![1];
    const second = vi.mocked(api.changeSubscription).mock.calls[1]![1];
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second).not.toHaveProperty("tenantId");
    expect(await screen.findByText(/订阅已更新为 enterprise_growth@2026-07/)).toBeVisible();
  });

  it("shows delinquency truth even when no active entitlement is available", async () => {
    const api = createApi(["tenant:read", "billing:read", "billing:write"]);
    api.getBillingEntitlements = vi.fn().mockRejectedValue(
      new EnterpriseApiError(404, "entitlement_not_found", "Not found", "trace-past-due"),
    );
    api.getBillingLifecycleStatus = vi.fn().mockResolvedValue(billingLifecycle({
      accountStatus: "past_due", subscriptionStatus: "past_due",
      lastEventType: "payment_failed", lastDecisionReason: "payment_failed",
    }));
    renderWithApi("/settings/billing", api);

    expect(await screen.findByText("past_due / past_due")).toBeVisible();
    expect(screen.getByText(/当前状态阻断新高成本任务/)).toBeVisible();
    expect(screen.getByText(/当前订阅状态没有活动 entitlement/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "提交变更" })).not.toBeInTheDocument();
  });

  it("updates a budget with its server version and renders ledger aggregates as read-only", async () => {
    const api = createApi(["tenant:read", "billing:read", "billing:write", "usage:read"]);
    api.listUsageBudgets = vi.fn().mockResolvedValue({ budgets: [budget()] });
    api.listUsageAggregates = vi.fn().mockResolvedValue({ aggregates: [aggregate()] });
    api.configureUsageBudget = vi.fn().mockResolvedValue({ budget: { ...budget(), limitAmount: 2400, version: 4 } });
    const user = userEvent.setup();
    renderWithApi("/settings/usage", api);

    expect(await screen.findByText("hash-abc…456789")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "编辑 会议音频" }));
    const limit = screen.getByLabelText("预算上限");
    await user.clear(limit);
    await user.type(limit, "2400");
    await user.click(screen.getByRole("button", { name: "保存预算" }));

    await waitFor(() => expect(api.configureUsageBudget).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a" }),
      "meeting_audio_seconds",
      expect.objectContaining({ limitAmount: 2400, expectedVersion: 3, unit: "seconds" }),
    ));
    expect(screen.getByText(/预算已保存为服务端版本 4/)).toBeVisible();
  });

  it("reports PostgreSQL unavailability without local billing fallback", async () => {
    const api = createApi(["tenant:read", "billing:read"]);
    api.getBillingEntitlements = vi.fn().mockRejectedValue(
      new EnterpriseApiError(503, "enterprise_postgres_required", "Unavailable", "trace-billing"),
    );
    renderWithApi("/settings/billing", api);

    expect(await screen.findByText(/未回退到 SQLite\/JSON/)).toBeVisible();
    expect(screen.getByText("trace-billing")).toBeVisible();
    expect(screen.queryByText("enterprise_growth")).not.toBeInTheDocument();
  });
});

function renderPage(path: string, scopes: EnterpriseScope[]) {
  const api = createApi(scopes);
  renderWithApi(path, api);
  return api;
}

function renderWithApi(path: string, api: EnterpriseApi) {
  const storage = new MemoryStorage();
  storage.setItem("wujie.enterprise.session.v1", JSON.stringify({
    token: "token-a", expiresAt: "2099-07-20T00:00:00Z", tenantId: "tenant-a", account: account(),
  }));
  render(<MemoryRouter initialEntries={[path]}><AuthProvider api={api} storage={storage}>
    <Routes><Route path="/settings/*" element={<EnterpriseSettingsPage />} /></Routes>
  </AuthProvider></MemoryRouter>);
}

function createApi(scopes: EnterpriseScope[]): EnterpriseApi {
  return {
    ...fakeEnterpriseContentApi(),
    requestCode: vi.fn(), login: vi.fn(), logout: vi.fn(), getTenantJob: vi.fn(),
    listTenants: vi.fn().mockResolvedValue({ tenants: [membership()] }),
    getTenantRoute: vi.fn().mockResolvedValue(route()),
    getContext: vi.fn().mockResolvedValue({ ...membership(), scopes } satisfies EnterpriseContextResponse),
    getProviderCapabilities: vi.fn().mockResolvedValue({ capabilities: [provider()] }),
    getBillingEntitlements: vi.fn().mockResolvedValue(entitlements()),
    getBillingLifecycleStatus: vi.fn().mockResolvedValue(billingLifecycle()),
  };
}

function membership() {
  const now = "2026-07-19T00:00:00Z";
  return {
    tenant: { id: "tenant-a", name: "Tenant A", status: "active" as const, homeRegion: "cn", cellId: "cn-cell-01", planCode: "enterprise_growth", dataRetentionDays: 30, createdAt: now, updatedAt: now, version: 7 },
    member: { id: "member-a", tenantId: "tenant-a", userId: "user-a", role: "owner" as const, status: "active" as const, createdAt: now, updatedAt: now, version: 1 },
  };
}

function route() {
  return { tenantId: "tenant-a", homeRegion: "cn", cellId: "cn-cell-01", routeEpoch: 7, apiBaseUrl: "https://api-cn.enterprise.example", rtcUrl: "wss://rtc-cn.enterprise.example", issuedAt: "2026-07-19T00:00:00Z", expiresAt: "2099-07-19T00:05:00Z", signature: "signed-route-document" };
}

function provider() {
  return { provider: "unconfigured", capability: "pstn.outbound" as const, status: "not_configured" as const, region: "cn", checkedAt: "2026-07-19T00:00:00Z", expiresAt: "2099-07-19T00:05:00Z", reasonCode: "provider_not_configured", features: {}, fingerprint: "unconfigured" };
}

function entitlements() {
  const now = "2026-07-19T00:00:00Z";
  return {
    account: { id: "billing-a", tenantId: "tenant-a", status: "active" as const, currency: "CNY", billingContactSubjectId: "private-contact-subject", createdAt: now, updatedAt: now, version: 2 },
    subscription: { id: "subscription-a", tenantId: "tenant-a", billingAccountId: "billing-a", planCode: "enterprise_growth", planVersion: "2026-07", status: "active", seats: 12, billingCycle: "annual", currentPeriodStart: now, currentPeriodEnd: "2027-07-19T00:00:00Z", createdAt: now, updatedAt: now, version: 3 },
    entitlement: { id: "entitlement-a", tenantId: "tenant-a", billingAccountId: "billing-a", subscriptionId: "subscription-a", entitlementVersion: "ent-3", status: "active" as const, planCode: "enterprise_growth", planVersion: "2026-07", entitlements: { "meeting.seats": { enabled: true, limit: 12 } }, effectiveFrom: now, createdAt: now },
  };
}

function billingLifecycle(overrides: Partial<EnterpriseBillingLifecycleStatusResponse> = {}) {
  return { ...baseBillingLifecycle(), ...overrides };
}

function baseBillingLifecycle(): EnterpriseBillingLifecycleStatusResponse {
  return { accountStatus: "active", subscriptionId: "subscription-a",
    subscriptionStatus: "active",
    currentPeriodStart: "2026-07-19T00:00:00Z",
    currentPeriodEnd: "2027-07-19T00:00:00Z",
    lastEventType: "renewed" as const, lastDecisionAction: "applied" as const,
    lastDecisionReason: "renewed", updatedAt: "2026-07-19T00:00:00Z" };
}

function budget() {
  return { id: "budget-a", tenantId: "tenant-a", billingAccountId: "billing-a", category: "meeting_audio_seconds" as const, unit: "seconds" as const, limitAmount: 1200, alertThresholdPercent: 80, status: "active" as const, periodStart: "2026-07-01T00:00:00Z", periodEnd: "2026-08-01T00:00:00Z", version: 3, updatedAt: "2026-07-19T00:00:00Z" };
}

function aggregate() {
  return { id: "aggregate-a", tenantId: "tenant-a", billingAccountId: "billing-a", category: "meeting_audio_seconds" as const, unit: "seconds" as const, periodStart: "2026-07-01T00:00:00Z", periodEnd: "2026-08-01T00:00:00Z", settledAmount: 900, adjustmentAmount: -20, netAmount: 880, settlementCount: 2, usageEventCount: 19, adjustmentCount: 1, ledgerCount: 20, ledgerHash: "hash-abcdef0123456789", sourceWatermark: "watermark-a", computedAt: "2026-07-19T00:00:00Z", version: 2 };
}

function account(): AccountDto {
  return { id: "user-a", phoneMasked: "138****0000", status: "active", createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z" };
}
