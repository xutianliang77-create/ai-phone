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

export function createEnterpriseTenant(input: {
  ownerUserId: string;
  name: string;
  homeRegion: string;
}) {
  return runStoreTransaction(() => {
    const now = new Date().toISOString();
    const tenant: EnterpriseTenantRecord = {
      id: randomUUID(),
      name: input.name,
      status: "active",
      homeRegion: input.homeRegion,
      planCode: "enterprise_trial",
      dataRetentionDays: 30,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const member: EnterpriseMemberRecord = {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: input.ownerUserId,
      role: "owner",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const store = getStoreSnapshot();
    store.enterpriseTenants.push(tenant);
    store.enterpriseMembers.push(member);
    persistStoreSnapshot();
    return { tenant, member };
  });
}

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

export function listEnterpriseMembers(tenantId: string) {
  return getStoreSnapshot().enterpriseMembers
    .filter((member) => member.tenantId === tenantId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function addEnterpriseMember(input: {
  tenantId: string;
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
      member.tenantId === input.tenantId && member.userId === input.userId
    );
    if (existing) return { status: "already_exists" as const, member: existing };
    const now = new Date().toISOString();
    const member: EnterpriseMemberRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    store.enterpriseMembers.push(member);
    persistStoreSnapshot();
    return { status: "created" as const, member };
  });
}

export function updateEnterpriseMember(input: {
  tenantId: string;
  memberId: string;
  role?: EnterpriseMemberRole;
  status?: EnterpriseMemberStatus;
}) {
  return runStoreTransaction(() => {
    const member = getStoreSnapshot().enterpriseMembers.find((item) =>
      item.tenantId === input.tenantId && item.id === input.memberId
    );
    if (!member) return { status: "not_found" as const };
    if (member.role === "owner") return { status: "owner_protected" as const };
    if (input.role) member.role = input.role;
    if (input.status) member.status = input.status;
    member.updatedAt = new Date().toISOString();
    member.version += 1;
    persistStoreSnapshot();
    return { status: "updated" as const, member };
  });
}

function activeTenant(tenantId: string) {
  return getStoreSnapshot().enterpriseTenants.find((tenant) =>
    tenant.id === tenantId && tenant.status === "active"
  );
}
