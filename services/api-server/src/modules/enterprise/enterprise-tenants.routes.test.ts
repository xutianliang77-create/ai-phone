import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";

describe("enterprise tenant routes", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.accounts = [];
    store.authSessions = [];
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
  });

  it("creates a tenant with an owner and resolves enterprise context", async () => {
    seedAccount("user-a", "token-a");
    const app = await buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/saas/v1/tenants",
      headers: auth("token-a"),
      payload: { name: "Acme Global", homeRegion: "cn" },
    });
    const tenantId = created.json().tenant.id as string;
    const context = await app.inject({
      method: "GET",
      url: "/enterprise/v1/me",
      headers: { ...auth("token-a"), "x-tenant-id": tenantId },
    });
    await app.close();

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      tenant: {
        name: "Acme Global",
        status: "active",
        homeRegion: "cn",
      },
      member: { userId: "user-a", role: "owner", status: "active" },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({
      tenant: { id: tenantId, name: "Acme Global" },
      member: { userId: "user-a", role: "owner" },
    });
  });

  it("rejects cross-tenant reads and client tenant spoofing", async () => {
    seedAccount("user-a", "token-a");
    seedAccount("user-b", "token-b");
    const app = await buildApp();
    const tenantA = await createTenant(app, "token-a", "Tenant A");
    const tenantB = await createTenant(app, "token-b", "Tenant B");
    const crossTenantRead = await app.inject({
      method: "GET",
      url: "/enterprise/v1/members",
      headers: { ...auth("token-b"), "x-tenant-id": tenantA },
    });
    const spoofedWrite = await app.inject({
      method: "POST",
      url: "/enterprise/v1/members",
      headers: { ...auth("token-a"), "x-tenant-id": tenantA },
      payload: { tenantId: tenantB, userId: "user-b", role: "member" },
    });
    const membersA = await app.inject({
      method: "GET",
      url: "/enterprise/v1/members",
      headers: { ...auth("token-a"), "x-tenant-id": tenantA },
    });
    await app.close();

    expect(crossTenantRead.statusCode).toBe(403);
    expect(crossTenantRead.json().error.code).toBe("tenant_access_denied");
    expect(spoofedWrite.statusCode).toBe(409);
    expect(spoofedWrite.json().error.code).toBe("tenant_context_mismatch");
    expect(membersA.json().members).toHaveLength(1);
  });

  it("scopes member updates and rejects duplicate tenant membership", async () => {
    seedAccount("owner-a", "token-a");
    seedAccount("owner-b", "token-b");
    seedAccount("member-user", "token-member");
    const app = await buildApp();
    const tenantA = await createTenant(app, "token-a", "Tenant A");
    const tenantB = await createTenant(app, "token-b", "Tenant B");
    const added = await app.inject({
      method: "POST",
      url: "/enterprise/v1/members",
      headers: { ...auth("token-a"), "x-tenant-id": tenantA },
      payload: { userId: "member-user", role: "member" },
    });
    const memberId = added.json().member.id as string;
    const duplicate = await app.inject({
      method: "POST",
      url: "/enterprise/v1/members",
      headers: { ...auth("token-a"), "x-tenant-id": tenantA },
      payload: { userId: "member-user", role: "auditor" },
    });
    const wrongTenantUpdate = await app.inject({
      method: "PATCH",
      url: `/enterprise/v1/members/${memberId}`,
      headers: { ...auth("token-b"), "x-tenant-id": tenantB },
      payload: { status: "suspended" },
    });
    const updated = await app.inject({
      method: "PATCH",
      url: `/enterprise/v1/members/${memberId}`,
      headers: { ...auth("token-a"), "x-tenant-id": tenantA },
      payload: { role: "auditor" },
    });
    await app.close();

    expect(added.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("member_already_exists");
    expect(wrongTenantUpdate.statusCode).toBe(404);
    expect(updated.statusCode).toBe(200);
    expect(updated.json().member).toMatchObject({
      id: memberId,
      tenantId: tenantA,
      role: "auditor",
      version: 2,
    });
  });

  it("requires tenant selection and blocks non-managers", async () => {
    seedAccount("owner-user", "owner-token");
    seedAccount("member-user", "member-token");
    seedAccount("other-user", "other-token");
    const app = await buildApp();
    const tenantA = await createTenant(app, "owner-token", "Tenant A");
    await createTenant(app, "owner-token", "Tenant B");
    const added = await app.inject({
      method: "POST",
      url: "/enterprise/v1/members",
      headers: { ...auth("owner-token"), "x-tenant-id": tenantA },
      payload: { userId: "member-user", role: "member" },
    });
    const ambiguous = await app.inject({
      method: "GET",
      url: "/enterprise/v1/me",
      headers: auth("owner-token"),
    });
    const denied = await app.inject({
      method: "POST",
      url: "/enterprise/v1/members",
      headers: { ...auth("member-token"), "x-tenant-id": tenantA },
      payload: { userId: "other-user", role: "member" },
    });
    await app.close();

    expect(added.statusCode).toBe(201);
    expect(ambiguous.statusCode).toBe(400);
    expect(ambiguous.json().error.code).toBe("tenant_selection_required");
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("member_management_denied");
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

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function createTenant(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/saas/v1/tenants",
    headers: auth(token),
    payload: { name, homeRegion: "cn" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().tenant.id as string;
}
