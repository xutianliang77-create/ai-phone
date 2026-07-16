import { randomUUID } from "node:crypto";
import type {
  EnterpriseMemberRole,
  EnterpriseMemberStatus,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";
import {
  appendEnterpriseAuditEvent,
} from "./enterprise-audit.repository.js";
import type {
  EnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

export function resolveEnterpriseContext(
  userId: string,
  selectedTenantId?: string,
) {
  const store = getStoreSnapshot();
  const memberships = store.enterpriseMembers.filter((member) =>
    member.userId === userId && member.status === "active"
  );
  if (selectedTenantId) {
    const member = memberships.find((item) => item.tenantId === selectedTenantId);
    if (!member) return { status: "access_denied" as const };
    const tenant = activeTenant(member.tenantId);
    return tenant
      ? { status: "resolved" as const, tenant, member }
      : { status: "access_denied" as const };
  }
  const active = memberships.flatMap((member) => {
    const tenant = activeTenant(member.tenantId);
    return tenant ? [{ tenant, member }] : [];
  });
  if (active.length === 0) return { status: "access_denied" as const };
  if (active.length > 1) return { status: "selection_required" as const };
  return { status: "resolved" as const, ...active[0]! };
}

export function listEnterpriseMembers(context: EnterpriseTenantContext) {
  return getStoreSnapshot().enterpriseMembers
    .filter((member) => member.tenantId === context.tenantId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function listEnterpriseMemberships(userId: string) {
  const store = getStoreSnapshot();
  return store.enterpriseMembers.flatMap((member) => {
    if (member.userId !== userId || member.status !== "active") return [];
    const tenant = activeTenant(member.tenantId);
    return tenant ? [{ tenant, member }] : [];
  });
}

export function addEnterpriseMember(input: {
  context: EnterpriseTenantContext;
  userId: string;
  role: EnterpriseMemberRole;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const account = store.accounts.find((item) =>
      item.id === input.userId && item.status === "active"
    );
    if (!account) return { status: "account_not_found" as const };
    const existing = store.enterpriseMembers.find((member) =>
      member.tenantId === input.context.tenantId &&
      member.userId === input.userId
    );
    if (existing) return { status: "already_exists" as const, member: existing };
    const now = new Date().toISOString();
    const member: EnterpriseMemberRecord = {
      id: randomUUID(),
      tenantId: input.context.tenantId,
      userId: input.userId,
      role: input.role,
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    store.enterpriseMembers.push(member);
    appendEnterpriseAuditEvent({
      context: input.context,
      action: "member.create",
      resourceType: "member",
      resourceId: member.id,
      result: "completed",
      details: {
        targetUserId: member.userId,
        role: member.role,
        status: member.status,
      },
      createdAt: now,
    });
    persistStoreSnapshot();
    return { status: "created" as const, member };
  });
}

export function updateEnterpriseMember(input: {
  context: EnterpriseTenantContext;
  memberId: string;
  role?: EnterpriseMemberRole;
  status?: EnterpriseMemberStatus;
}) {
  return runStoreTransaction(() => {
    const member = getStoreSnapshot().enterpriseMembers.find((item) =>
      item.tenantId === input.context.tenantId && item.id === input.memberId
    );
    if (!member) return { status: "not_found" as const };
    if (member.role === "owner") return { status: "owner_protected" as const };
    if (input.role) member.role = input.role;
    if (input.status) member.status = input.status;
    const now = new Date().toISOString();
    member.updatedAt = now;
    member.version += 1;
    appendEnterpriseAuditEvent({
      context: input.context,
      action: "member.update",
      resourceType: "member",
      resourceId: member.id,
      result: "completed",
      details: {
        targetUserId: member.userId,
        role: member.role,
        status: member.status,
        version: member.version,
      },
      createdAt: now,
    });
    persistStoreSnapshot();
    return { status: "updated" as const, member };
  });
}

function activeTenant(tenantId: string) {
  return getStoreSnapshot().enterpriseTenants.find((tenant) =>
    tenant.id === tenantId && tenant.status === "active"
  );
}
