import { randomUUID } from "node:crypto";
import type { EnterpriseTenantJobType } from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantLifecycleSnapshot,
  EnterpriseTenantJobRecord,
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";
import type { TenantProvisionResult } from "./enterprise-tenant-provisioner.js";
import { enterpriseScopesForRole } from "./enterprise-rbac.js";
import {
  auditEnterpriseTenantJob,
  auditEnterpriseTenantLifecycleDenied,
} from "./enterprise-tenant-audit.js";
import {
  allowsLifecycleAction,
  hasProcessingTenantExport,
  hashRequest,
  safeErrorCode,
  validCellId,
} from "./enterprise-tenant-lifecycle-values.js";

export function beginEnterpriseTenantCreation(input: {
  ownerUserId: string;
  name: string;
  homeRegion: string;
  idempotencyKey: string;
  traceId: string;
}) {
  const requestHash = hashRequest([input.name, input.homeRegion]);
  return runStoreTransaction(() => {
    const existing = findIdempotentJob(
      input.ownerUserId,
      "tenant.provision",
      input.idempotencyKey,
    );
    if (existing) return existingResult(existing, requestHash);

    const now = new Date().toISOString();
    const tenant: EnterpriseTenantRecord = {
      id: randomUUID(),
      name: input.name,
      status: "provisioning",
      homeRegion: input.homeRegion,
      planCode: "enterprise_trial",
      dataRetentionDays: 30,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const member = ownerMember(tenant.id, input.ownerUserId, now);
    const job = createJob(
      tenant.id,
      input.ownerUserId,
      "tenant.provision",
      input.idempotencyKey,
      requestHash,
      now,
    );
    const store = getStoreSnapshot();
    store.enterpriseTenants.push(tenant);
    store.enterpriseMembers.push(member);
    store.enterpriseTenantJobs.push(job);
    auditEnterpriseTenantJob(job, "accepted", input.traceId, now);
    persistStoreSnapshot();
    return { status: "created" as const, tenant, member, job };
  });
}

export function beginEnterpriseTenantRetry(input: {
  tenantId: string;
  actorUserId: string;
  idempotencyKey: string;
  traceId: string;
}) {
  const requestHash = hashRequest([input.tenantId]);
  return runStoreTransaction(() => {
    const existing = findIdempotentJob(
      input.actorUserId,
      "tenant.provision",
      input.idempotencyKey,
    );
    if (existing) return existingResult(existing, requestHash);
    const tenant = findTenant(input.tenantId);
    const member = findManagerMembership(input.tenantId, input.actorUserId);
    if (!tenant) return { status: "not_found" as const };
    if (!member) {
      auditEnterpriseTenantLifecycleDenied({
        tenantId: tenant.id,
        actorUserId: input.actorUserId,
        action: "tenant.provision",
        traceId: input.traceId,
      });
      return { status: "not_found" as const };
    }
    if (tenant.status !== "provisioning_failed") {
      return { status: "invalid_state" as const, tenant };
    }
    const now = new Date().toISOString();
    tenant.status = "provisioning";
    tenant.updatedAt = now;
    tenant.version += 1;
    const job = createJob(
      tenant.id,
      input.actorUserId,
      "tenant.provision",
      input.idempotencyKey,
      requestHash,
      now,
    );
    getStoreSnapshot().enterpriseTenantJobs.push(job);
    auditEnterpriseTenantJob(job, "accepted", input.traceId, now);
    persistStoreSnapshot();
    return { status: "created" as const, tenant, member, job };
  });
}

export function finalizeEnterpriseTenantProvision(
  jobId: string,
  result: TenantProvisionResult,
) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const job = store.enterpriseTenantJobs.find((item) => item.id === jobId);
    const tenant = job && store.enterpriseTenants.find((item) => item.id === job.tenantId);
    const member = job && store.enterpriseMembers.find((item) =>
      item.tenantId === job.tenantId && item.userId === job.actorUserId
    );
    if (!job || !tenant || !member) return { status: "not_found" as const };
    if (job.status !== "processing" || job.type !== "tenant.provision" ||
      tenant.status !== "provisioning") {
      return { status: "unchanged" as const, tenant, member, job };
    }
    const now = new Date().toISOString();
    if (result.status === "ready" && validCellId(result.cellId)) {
      tenant.status = "active";
      tenant.cellId = result.cellId;
      job.status = "completed";
      job.completedAt = now;
    } else {
      tenant.status = "provisioning_failed";
      job.status = "failed";
      job.errorCode = result.status === "not_ready"
        ? safeErrorCode(result.reason)
        : "invalid_cell_id";
    }
    tenant.updatedAt = now;
    tenant.version += 1;
    job.updatedAt = now;
    auditEnterpriseTenantJob(
      job,
      job.status === "completed" ? "completed" : "failed",
      `tenant-job:${job.id}`,
      now,
    );
    persistStoreSnapshot();
    return { status: "updated" as const, tenant, member, job };
  });
}

export function startEnterpriseTenantLifecycleJob(input: {
  tenantId: string;
  actorUserId: string;
  type: Exclude<EnterpriseTenantJobType, "tenant.provision">;
  idempotencyKey: string;
  traceId: string;
}) {
  const requestHash = hashRequest([input.tenantId, input.type]);
  return runStoreTransaction(() => {
    const existing = findIdempotentJob(
      input.actorUserId,
      input.type,
      input.idempotencyKey,
    );
    if (existing) return existingResult(existing, requestHash);
    const tenant = findTenant(input.tenantId);
    const member = findManagerMembership(input.tenantId, input.actorUserId);
    if (!tenant || tenant.status === "deleted") {
      return { status: "not_found" as const };
    }
    if (!member) {
      auditEnterpriseTenantLifecycleDenied({
        tenantId: tenant.id,
        actorUserId: input.actorUserId,
        action: input.type,
        traceId: input.traceId,
      });
      return { status: "not_found" as const };
    }
    if (!allowsLifecycleAction(tenant)) {
      return { status: "invalid_state" as const, tenant };
    }
    if (
      input.type === "tenant.delete" &&
      hasProcessingTenantExport(input.tenantId)
    ) {
      return { status: "pending_jobs" as const, tenant };
    }
    const now = new Date().toISOString();
    const job = createJob(
      tenant.id,
      input.actorUserId,
      input.type,
      input.idempotencyKey,
      requestHash,
      now,
    );
    const store = getStoreSnapshot();
    if (input.type === "tenant.suspend") {
      tenant.status = "suspended";
      job.status = "completed";
      job.completedAt = now;
    } else if (input.type === "tenant.delete") {
      tenant.status = "deletion_requested";
    }
    tenant.updatedAt = now;
    tenant.version += 1;
    if (input.type === "tenant.export" || input.type === "tenant.delete") {
      job.scopeSnapshot = lifecycleSnapshot(store, tenant, member, job, now);
    }
    store.enterpriseTenantJobs.push(job);
    auditEnterpriseTenantJob(
      job,
      job.status === "completed" ? "completed" : "accepted",
      input.traceId,
      now,
    );
    persistStoreSnapshot();
    return { status: "created" as const, tenant, member, job };
  });
}

export function findEnterpriseTenantJob(jobId: string, userId: string) {
  const job = getStoreSnapshot().enterpriseTenantJobs.find((item) => item.id === jobId);
  if (!job || (job.actorUserId !== userId &&
    !findManagerMembership(job.tenantId, userId))) return null;
  return job;
}

function existingResult(job: EnterpriseTenantJobRecord, requestHash: string) {
  if (job.requestHash !== requestHash) return { status: "conflict" as const };
  const tenant = findTenant(job.tenantId);
  const member = getStoreSnapshot().enterpriseMembers.find((item) =>
    item.tenantId === job.tenantId && item.userId === job.actorUserId
  );
  return tenant && member
    ? { status: "existing" as const, tenant, member, job }
    : { status: "not_found" as const };
}

function findIdempotentJob(
  actorUserId: string,
  type: EnterpriseTenantJobType,
  idempotencyKey: string,
) {
  return getStoreSnapshot().enterpriseTenantJobs.find((job) =>
    job.actorUserId === actorUserId && job.type === type &&
    job.idempotencyKey === idempotencyKey
  );
}

function findTenant(tenantId: string) {
  return getStoreSnapshot().enterpriseTenants.find((tenant) => tenant.id === tenantId);
}

function findManagerMembership(tenantId: string, userId: string) {
  return getStoreSnapshot().enterpriseMembers.find((member) =>
    member.tenantId === tenantId && member.userId === userId &&
    member.status === "active" && (member.role === "owner" || member.role === "admin")
  );
}

function ownerMember(tenantId: string, userId: string, now: string): EnterpriseMemberRecord {
  return {
    id: randomUUID(), tenantId, userId, role: "owner", status: "active",
    joinedAt: now, createdAt: now, updatedAt: now, version: 1,
  };
}

function createJob(
  tenantId: string,
  actorUserId: string,
  type: EnterpriseTenantJobType,
  idempotencyKey: string,
  requestHash: string,
  now: string,
): EnterpriseTenantJobRecord {
  return {
    id: randomUUID(), tenantId, actorUserId, type, idempotencyKey,
    requestHash, status: "processing", attempts: 0,
    createdAt: now, updatedAt: now,
  };
}

function lifecycleSnapshot(
  store: ReturnType<typeof getStoreSnapshot>,
  tenant: EnterpriseTenantRecord,
  member: EnterpriseMemberRecord,
  job: EnterpriseTenantJobRecord,
  now: string,
): EnterpriseTenantLifecycleSnapshot {
  const { billingCustomerRef: _billingCustomerRef, ...safeTenant } = tenant;
  return {
    requestedAt: now,
    actor: {
      userId: member.userId,
      role: managerRole(member.role),
      scopes: [...enterpriseScopesForRole(member.role)],
    },
    tenant: structuredClone(safeTenant),
    members: structuredClone(
      store.enterpriseMembers
        .filter((item) => item.tenantId === tenant.id)
        .sort((left, right) => left.id.localeCompare(right.id)),
    ),
    tenantJobs: [...store.enterpriseTenantJobs
      .filter((item) => item.tenantId === tenant.id), job]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(safeJobSnapshot),
  };
}

function managerRole(role: EnterpriseMemberRecord["role"]) {
  return role === "admin" ? "admin" as const : "owner" as const;
}

function safeJobSnapshot(job: EnterpriseTenantJobRecord) {
  return {
    id: job.id,
    tenantId: job.tenantId,
    actorUserId: job.actorUserId,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    errorCode: job.errorCode,
    receiptRef: job.receiptRef,
    receiptHash: job.receiptHash,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
