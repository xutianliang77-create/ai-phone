import type { Page, Route } from "@playwright/test";
import {
  enterpriseRoleScopes,
  type EnterpriseClientEventRequest,
  type EnterpriseMemberRole,
} from "@translation/contracts";

const now = "2026-07-19T00:00:00.000Z";

export async function installEnterpriseFixture(
  page: Page,
  role: EnterpriseMemberRole,
) {
  const clientEvents: EnterpriseClientEventRequest[] = [];
  await page.addInitScript((session) => {
    window.sessionStorage.setItem("wujie.enterprise.session.v1", JSON.stringify(session));
  }, {
    token: "fixture-token",
    expiresAt: "2099-07-19T00:00:00.000Z",
    tenantId: "tenant-fixture",
    account: account(),
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === "/enterprise/v1/observability/client-events" &&
      request.method() === "POST") {
      clientEvents.push(request.postDataJSON() as EnterpriseClientEventRequest);
      return json(route, { accepted: true, traceId: "trace-client-fixture" }, 202);
    }
    const response = fixtureResponse(path, role);
    return response
      ? json(route, response.body, response.status)
      : json(route, {
        error: { code: "fixture_not_ready", message: "Fixture endpoint not configured" },
      }, 503);
  });
  return { clientEvents };
}

function fixtureResponse(path: string, role: EnterpriseMemberRole) {
  if (path === "/enterprise/v1/tenants") {
    return ok({ tenants: [membership(role)] });
  }
  if (path === "/saas/v1/tenants/tenant-fixture/route") {
    return ok(routeDocument());
  }
  if (path === "/enterprise/v1/me") {
    return ok({ ...membership(role), scopes: enterpriseRoleScopes[role] });
  }
  if (path === "/enterprise/v1/provider-capabilities") {
    return ok({ capabilities: providerCapabilities() });
  }
  return null;
}

function membership(role: EnterpriseMemberRole) {
  return {
    tenant: {
      id: "tenant-fixture",
      name: "矩阵测试企业",
      status: "active",
      homeRegion: "cn",
      cellId: "cn-cell-fixture",
      planCode: "enterprise_trial",
      dataRetentionDays: 30,
      createdAt: now,
      updatedAt: now,
      version: 7,
    },
    member: {
      id: "member-fixture",
      tenantId: "tenant-fixture",
      userId: "user-fixture",
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
      version: 3,
    },
  };
}

function account() {
  return {
    id: "user-fixture",
    phoneMasked: "138****0000",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function routeDocument() {
  return {
    tenantId: "tenant-fixture",
    homeRegion: "cn",
    cellId: "cn-cell-fixture",
    routeEpoch: 7,
    apiBaseUrl: "https://api-cn.enterprise.example",
    rtcUrl: "wss://rtc-cn.enterprise.example",
    issuedAt: now,
    expiresAt: "2099-07-19T00:00:00.000Z",
    signature: "fixture-signed-route",
  };
}

function providerCapabilities() {
  return ["pstn.outbound", "crm.sync", "calendar.meetings", "channel.messaging"]
    .map((capability) => ({
      provider: "not_configured",
      capability,
      status: "not_configured",
      region: "cn",
      checkedAt: now,
      expiresAt: "2099-07-19T00:00:00.000Z",
      reasonCode: "provider_not_configured",
      features: {},
      fingerprint: "unconfigured",
    }));
}

function ok(body: unknown) {
  return { body, status: 200 };
}

function json(route: Route, body: unknown, status: number) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
