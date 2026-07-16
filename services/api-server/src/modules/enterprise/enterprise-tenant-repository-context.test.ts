import { beforeEach, describe, expect, it } from "vitest";
import {
  getStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import {
  appendEnterpriseAuditEvent,
  listEnterpriseAuditEvents,
} from "./enterprise-audit.repository.js";
import {
  claimEnterpriseTenantLifecycleJob,
} from "./enterprise-tenant-job.repository.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import {
  listEnterpriseMembers,
  updateEnterpriseMember,
} from "./enterprise-tenants.repository.js";

describe("enterprise tenant-scoped repositories", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.enterpriseTenants = [];
    store.enterpriseMembers = [];
    store.enterpriseTenantJobs = [];
    store.enterpriseAuditEvents = [];
    seedTenant("tenant-a", "owner-a", "member-a");
    seedTenant("tenant-b", "owner-b", "member-b");
  });

  it("does not read or update records outside the context tenant", () => {
    const contextA = context("tenant-a", "owner-a");
    const contextB = context("tenant-b", "owner-b");

    expect(listEnterpriseMembers(contextA).map(({ id }) => id))
      .toEqual(["member-a"]);
    expect(listEnterpriseMembers(contextB).map(({ id }) => id))
      .toEqual(["member-b"]);
    expect(updateEnterpriseMember({
      context: contextB,
      memberId: "member-a",
      status: "suspended",
    })).toEqual({ status: "not_found" });
    expect(getStoreSnapshot().enterpriseMembers.find(
      ({ id }) => id === "member-a",
    )?.status).toBe("active");
  });

  it("isolates audit reads and lifecycle job claims", () => {
    const contextA = context("tenant-a", "owner-a");
    const contextB = context("tenant-b", "owner-b");
    appendEnterpriseAuditEvent({
      context: contextA,
      action: "member.update",
      resourceType: "member",
      resourceId: "member-a",
      result: "completed",
    });

    expect(listEnterpriseAuditEvents({
      context: contextA,
      limit: 10,
    }).events).toHaveLength(1);
    expect(listEnterpriseAuditEvents({
      context: contextB,
      limit: 10,
    }).events).toEqual([]);
    expect(claimEnterpriseTenantLifecycleJob({
      context: contextB,
      jobId: "job-a",
      now: new Date("2026-07-16T00:01:00.000Z"),
      force: true,
    })).toEqual({ status: "not_found" });
    expect(claimEnterpriseTenantLifecycleJob({
      context: context("tenant-a", "different-actor"),
      jobId: "job-a",
      now: new Date("2026-07-16T00:01:00.000Z"),
      force: true,
    })).toEqual({ status: "not_found" });
    expect(claimEnterpriseTenantLifecycleJob({
      context: contextA,
      jobId: "job-a",
      now: new Date("2026-07-16T00:01:00.000Z"),
      force: true,
    }).status).toBe("claimed");
  });
});

function context(tenantId: string, actorUserId: string) {
  return createEnterpriseTenantContext({
    tenantId,
    actorUserId,
    actorRole: "owner",
    traceId: `trace-${tenantId}`,
  });
}

function seedTenant(tenantId: string, userId: string, memberId: string) {
  const store = getStoreSnapshot();
  const now = "2026-07-16T00:00:00.000Z";
  store.enterpriseTenants.push({
    id: tenantId,
    name: tenantId,
    status: "active",
    homeRegion: "cn",
    cellId: "cn-cell-01",
    planCode: "enterprise_trial",
    dataRetentionDays: 30,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  store.enterpriseMembers.push({
    id: memberId,
    tenantId,
    userId,
    role: "owner",
    status: "active",
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
  if (tenantId !== "tenant-a") return;
  store.enterpriseTenantJobs.push({
    id: "job-a",
    tenantId,
    actorUserId: userId,
    type: "tenant.export",
    idempotencyKey: "export-a",
    requestHash: "hash-a",
    status: "processing",
    attempts: 0,
    scopeSnapshot: {
      requestedAt: now,
      actor: {
        userId,
        role: "owner",
        scopes: ["tenant:read", "tenant:write"],
      },
      tenant: structuredClone(store.enterpriseTenants.at(-1)!),
      members: structuredClone(store.enterpriseMembers.slice(-1)),
      tenantJobs: [],
    },
    createdAt: now,
    updatedAt: now,
  });
}
