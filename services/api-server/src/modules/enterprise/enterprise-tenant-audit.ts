import type {
  EnterpriseTenantJobType,
} from "@translation/contracts";
import {
  appendEnterpriseAuditEvent,
} from "./enterprise-audit.repository.js";
import type {
  EnterpriseTenantJobRecord,
} from "./enterprise-tenant-record.js";

export function auditEnterpriseTenantJob(
  job: EnterpriseTenantJobRecord,
  result: "accepted" | "completed" | "failed",
  traceId: string,
  createdAt: string,
) {
  appendEnterpriseAuditEvent({
    tenantId: job.tenantId,
    actorUserId: job.actorUserId,
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
    traceId,
    createdAt,
  });
}

export function auditEnterpriseTenantLifecycleDenied(input: {
  tenantId: string;
  actorUserId: string;
  action: EnterpriseTenantJobType;
  traceId: string;
}) {
  appendEnterpriseAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: input.action,
    resourceType: "tenant",
    resourceId: input.tenantId,
    result: "denied",
    details: { reasonCode: "manager_membership_required" },
    traceId: input.traceId,
  });
}
