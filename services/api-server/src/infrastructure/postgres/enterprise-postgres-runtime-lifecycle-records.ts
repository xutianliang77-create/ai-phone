import { createHash, randomUUID } from "node:crypto";
import type {
  EnterpriseTenantJobType,
} from "@translation/contracts";
import {
  createEnterpriseAuditEvent,
} from "../../modules/enterprise/enterprise-audit.repository.js";
import {
  enterpriseScopesForRole,
} from "../../modules/enterprise/enterprise-rbac.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseAuditEventRecord,
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
  EnterpriseTenantLifecycleSnapshot,
  EnterpriseTenantRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";

export function deterministicProvisionTenantId(
  ownerUserId: string,
  idempotencyKey: string,
) {
  const bytes = createHash("sha256")
    .update("enterprise-tenant-provision\0")
    .update(ownerUserId)
    .update("\0")
    .update(idempotencyKey)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function provisionRecords(input: {
  tenantId: string;
  ownerUserId: string;
  name: string;
  homeRegion: string;
  idempotencyKey: string;
  requestHash: string;
  now: string;
}) {
  const tenant: EnterpriseTenantRecord = {
    id: input.tenantId,
    name: input.name,
    status: "provisioning",
    homeRegion: input.homeRegion,
    planCode: "enterprise_trial",
    dataRetentionDays: 30,
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  };
  const member: EnterpriseMemberRecord = {
    id: randomUUID(),
    tenantId: input.tenantId,
    userId: input.ownerUserId,
    role: "owner",
    status: "active",
    joinedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  };
  const job = lifecycleJob({
    tenantId: input.tenantId,
    actorUserId: input.ownerUserId,
    type: "tenant.provision",
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    now: input.now,
  });
  return { tenant, member, job };
}

export function lifecycleJob(input: {
  tenantId: string;
  actorUserId: string;
  type: EnterpriseTenantJobType;
  idempotencyKey: string;
  requestHash: string;
  now: string;
}): EnterpriseTenantJobRecord {
  return {
    id: randomUUID(),
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    status: "processing",
    attempts: 0,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function lifecycleSnapshot(input: {
  tenant: EnterpriseTenantRecord;
  member: EnterpriseMemberRecord;
  members: EnterpriseMemberRecord[];
  jobs: EnterpriseTenantJobRecord[];
  newJob: EnterpriseTenantJobRecord;
  now: string;
}): EnterpriseTenantLifecycleSnapshot {
  const { billingCustomerRef: _billingCustomerRef, ...safeTenant } = input.tenant;
  return {
    requestedAt: input.now,
    actor: {
      userId: input.member.userId,
      role: input.member.role === "admin" ? "admin" : "owner",
      scopes: [...enterpriseScopesForRole(input.member.role)],
    },
    tenant: structuredClone(safeTenant),
    members: structuredClone(
      [...input.members].sort((left, right) => left.id.localeCompare(right.id)),
    ),
    tenantJobs: [...input.jobs, input.newJob]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((job) => ({
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
      })),
  };
}

export function lifecycleAuditEvent(
  job: EnterpriseTenantJobRecord,
  result: "accepted" | "completed" | "failed",
  traceId: string,
  createdAt: string,
): EnterpriseAuditEventRecord {
  return createEnterpriseAuditEvent({
    context: createEnterpriseTenantContext({
      tenantId: job.tenantId,
      actorUserId: job.actorUserId,
      actorRole: job.scopeSnapshot?.actor.role,
      traceId,
    }),
    action: job.type,
    resourceType: "tenant",
    resourceId: job.tenantId,
    result,
    details: {
      jobId: job.id,
      jobType: job.type,
      status: job.status,
      attempts: job.attempts,
      errorCode: job.errorCode,
    },
    createdAt,
  });
}

export function lifecycleDeniedAuditEvent(input: {
  tenantId: string;
  actorUserId: string;
  type: EnterpriseTenantJobType;
  traceId: string;
}) {
  return createEnterpriseAuditEvent({
    context: createEnterpriseTenantContext({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      traceId: input.traceId,
    }),
    action: input.type,
    resourceType: "tenant",
    resourceId: input.tenantId,
    result: "denied",
    details: { reasonCode: "manager_membership_required" },
  });
}

export function managerMember(member: EnterpriseMemberRecord | null) {
  return member?.status === "active" &&
      (member.role === "owner" || member.role === "admin")
    ? member
    : null;
}

export function executableLifecycleJob(job: EnterpriseTenantJobRecord) {
  return job.type === "tenant.export" || job.type === "tenant.delete";
}
