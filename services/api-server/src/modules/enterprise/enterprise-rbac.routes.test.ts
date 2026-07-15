import { beforeEach, describe, expect, it } from "vitest";
import {
  enterpriseMemberRoles,
  enterpriseScopes,
  type EnterpriseMemberRole,
} from "@translation/contracts";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  enterpriseScopesForRole,
  hasEnterpriseScope,
} from "./enterprise-rbac.js";

describe("enterprise RBAC route guard", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
  });

  it("enforces every role across tenant and member operations", async () => {
    for (const role of enterpriseMemberRoles) {
      seedAccount(roleUser(role), roleToken(role));
      seedAccount(candidateUser(role), `candidate-${role}-token`);
    }
    const app = await buildApp();
    const tenantId = await createTenant(app);
    let updateTargetId = "";
    for (const role of enterpriseMemberRoles) {
      if (role === "owner") continue;
      const member = await addMember(app, tenantId, roleUser(role), role);
      if (role === "member") updateTargetId = member.id as string;
    }

    for (const role of enterpriseMemberRoles) {
      const headers = {
        ...tenantAuth(roleToken(role), tenantId),
        "x-enterprise-scopes": enterpriseScopes.join(" "),
      };
      const me = await app.inject({
        method: "GET",
        url: "/enterprise/v1/me",
        headers,
      });
      expect(me.statusCode, `${role} tenant:read`).toBe(200);
      expect(me.json().scopes).toEqual(enterpriseScopesForRole(role));

      const members = await app.inject({
        method: "GET",
        url: "/enterprise/v1/members",
        headers,
      });
      expect(members.statusCode, `${role} member:read`).toBe(
        hasEnterpriseScope(role, "member:read") ? 200 : 403,
      );

      const created = await app.inject({
        method: "POST",
        url: "/enterprise/v1/members",
        headers,
        payload: { userId: candidateUser(role), role: "member" },
      });
      const canWrite = hasEnterpriseScope(role, "member:write");
      expect(created.statusCode, `${role} member:create`).toBe(canWrite ? 201 : 403);

      const updated = await app.inject({
        method: "PATCH",
        url: `/enterprise/v1/members/${updateTargetId}`,
        headers,
        payload: { role: "member" },
      });
      expect(updated.statusCode, `${role} member:update`).toBe(canWrite ? 200 : 403);
      if (!canWrite) {
        expect(updated.json().error.code).toBe("enterprise_scope_denied");
      }
    }
    await app.close();
  });
});

function seedAccount(userId: string, token: string) {
  const now = new Date().toISOString();
  const store = getStoreSnapshot();
  store.accounts.push({
    id: userId,
    phoneHash: `hash-${userId}`,
    phoneMasked: "138****0000",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  store.authSessions.push({
    token,
    userId,
    createdAt: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
}

async function createTenant(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/saas/v1/tenants",
    headers: auth(roleToken("owner")),
    payload: { name: "RBAC Tenant", homeRegion: "cn" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().tenant.id as string;
}

async function addMember(
  app: Awaited<ReturnType<typeof buildApp>>,
  tenantId: string,
  userId: string,
  role: EnterpriseMemberRole,
) {
  const response = await app.inject({
    method: "POST",
    url: "/enterprise/v1/members",
    headers: tenantAuth(roleToken("owner"), tenantId),
    payload: { userId, role },
  });
  expect(response.statusCode).toBe(201);
  return response.json().member as Record<string, unknown>;
}

function roleUser(role: EnterpriseMemberRole) {
  return `${role}-user`;
}

function candidateUser(role: EnterpriseMemberRole) {
  return `${role}-candidate`;
}

function roleToken(role: EnterpriseMemberRole) {
  return `${role}-token`;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

function tenantAuth(token: string, tenantId: string) {
  return { ...auth(token), "x-tenant-id": tenantId };
}
