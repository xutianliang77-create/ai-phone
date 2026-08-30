import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  withEnterpriseCellPostgresSession,
} from "./enterprise-postgres-cell-session.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  enterprisePostgresAccountSubjectId,
} from "./enterprise-postgres-subject-id.js";
import { enterpriseMeetingScreenShareMaxPauseSeconds } from
  "./enterprise-postgres-meeting-screen-share-runtime.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";

export interface EnterprisePostgresPendingWorkRow extends Record<string, unknown> {
  cell_id: unknown;
  tenant_id: unknown;
  work_kind: unknown;
  resource_id: unknown;
  actor_id: unknown;
}

export type EnterprisePostgresPendingWorkRef =
  | {
      cellId: string;
      tenantId: string;
      workKind: "tenant_lifecycle";
      resourceId: string;
      actorUserId: string;
    }
  | {
      cellId: string;
      tenantId: string;
      workKind: "outbox";
      resourceId: string;
    }
  | {
      cellId: string;
      tenantId: string;
      workKind: "audit_export";
      resourceId: string;
      actorUserId: string;
    }
  | {
      cellId: string;
      tenantId: string;
      workKind: "screen_share";
      resourceId: string;
    }
  | {
      cellId: string;
      tenantId: string;
      workKind: "data_lifecycle";
      resourceId: string;
    }
  | {
      cellId: string;
      tenantId: string;
      workKind: "billing_lifecycle";
      resourceId: string;
    };

export function listEnterprisePostgresPendingWork(input: {
  pool: EnterpriseTenantPostgresPool;
  cellId: string;
  workerId: string;
  traceId: string;
  now: string;
  limit: number;
}) {
  assertLimit(input.limit);
  assertTimestamp(input.now);
  return withEnterpriseCellPostgresSession(
    input.pool,
    {
      cellId: input.cellId,
      workerId: input.workerId,
      traceId: input.traceId,
    },
    async (session) => {
      const result = await session.query<EnterprisePostgresPendingWorkRow>(`
        SELECT cell_id, tenant_id, work_kind, resource_id, actor_id
        FROM enterprise.platform_pending_work
        WHERE cell_id = $1 AND due_at <= $2
          AND COALESCE(
            lease_expires_at,
            '-infinity'::timestamptz
          ) <= $2
        ORDER BY due_at, work_kind, tenant_id, resource_id
        LIMIT $3
      `, [input.now, input.limit]);
      return result.rows.map((row) =>
        mapEnterprisePostgresPendingWorkRow(row, session.cellId)
      );
    },
  );
}

export async function claimEnterprisePostgresPendingWork(input: {
  pool: EnterpriseTenantPostgresPool;
  cellId: string;
  ref: EnterprisePostgresPendingWorkRef;
  now: string;
  leaseExpiresAt: string;
  traceId: string;
  workerId?: string;
}) {
  assertTimestamp(input.now);
  assertTimestamp(input.leaseExpiresAt);
  assertCellId(input.cellId);
  if (Date.parse(input.leaseExpiresAt) <= Date.parse(input.now)) {
    throw new Error("Enterprise pending work lease must be in the future");
  }
  if (input.ref.cellId !== input.cellId) {
    throw new Error("Enterprise pending work cell mismatch");
  }
  const actorUserId = input.ref.workKind === "tenant_lifecycle" ||
    input.ref.workKind === "audit_export"
    ? enterprisePostgresAccountSubjectId(input.ref.actorUserId)
    : input.ref.workKind === "outbox"
    ? "system:enterprise-outbox"
    : input.ref.workKind === "data_lifecycle"
    ? "system:enterprise-data-lifecycle"
    : input.ref.workKind === "billing_lifecycle"
    ? "system:enterprise-billing-lifecycle"
    : "system:enterprise-screen-share";
  const context = createEnterpriseTenantContext({
    tenantId: input.ref.tenantId,
    actorUserId,
    traceId: input.traceId,
  });
  return withEnterprisePostgresUnitOfWork(
    input.pool,
    context,
    async (unit) => {
      const tenant = await unit.tenant.findTenant({ lock: true });
      if (!tenant || tenant.cellId !== input.cellId) {
        throw new Error("Enterprise pending work tenant cell mismatch");
      }
      if (input.ref.workKind === "tenant_lifecycle") {
        return {
          workKind: input.ref.workKind,
          result: await unit.lifecycle.claimJob({
            jobId: input.ref.resourceId,
            now: input.now,
            leaseExpiresAt: input.leaseExpiresAt,
          }),
        };
      }
      if (input.ref.workKind === "audit_export") {
        return {
          workKind: input.ref.workKind,
          result: await unit.auditExports.claim({
            id: input.ref.resourceId,
            now: input.now,
            leaseExpiresAt: input.leaseExpiresAt,
          }),
        };
      }
      if (input.ref.workKind === "screen_share") {
        const result = await unit.meetingScreenShares.current({
          meetingId: input.ref.resourceId,
          now: new Date(input.now),
          maxPauseSeconds: enterpriseMeetingScreenShareMaxPauseSeconds(),
        });
        for (const item of result.revoked) {
          await unit.events.insertOutbox({
            id: randomUUID(), tenantId: input.ref.tenantId,
            aggregateType: "screen_share", aggregateId: item.shareId,
            eventType: "meeting.screen_share.revoke.requested",
            idempotencyKey: `screen-share-revoke:${item.shareId}:g${item.generation}`,
            payload: item, traceId: input.traceId, attempts: 0,
            availableAt: input.now, createdAt: input.now,
          });
        }
        return {
          workKind: input.ref.workKind,
          result: result.revoked.length > 0
            ? { status: "claimed" as const }
            : { status: "busy" as const },
        };
      }
      if (input.ref.workKind === "data_lifecycle") {
        return {
          workKind: input.ref.workKind,
          result: await unit.dataLifecycle.claim({
            id: input.ref.resourceId,
            now: input.now,
            leaseExpiresAt: input.leaseExpiresAt,
            expedite: tenant.status === "deletion_requested" ||
              tenant.status === "deleted",
          }),
        };
      }
      if (input.ref.workKind === "billing_lifecycle") {
        const result = await unit.billingLifecycle.claim({
          commandId: input.ref.resourceId,
          workerId: input.workerId ?? `enterprise-worker:${input.cellId}`,
          now: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
        });
        if (result.status === "failed") {
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context,
            action: "subscription.lifecycle.retry_exhausted",
            resourceType: "subscription_lifecycle_command",
            resourceId: result.command.id,
            result: "failed",
            details: { eventId: result.command.eventId,
              attempts: result.command.attempts,
              errorCode: result.command.errorCode ?? "retry_exhausted" },
            createdAt: input.now,
          }));
        }
        return {
          workKind: input.ref.workKind,
          result,
        };
      }
      return {
        workKind: input.ref.workKind,
        result: await unit.events.claimOutbox({
          eventId: input.ref.resourceId,
          now: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
        }),
      };
    },
  );
}

export function mapEnterprisePostgresPendingWorkRow(
  row: EnterprisePostgresPendingWorkRow,
  cellId: string,
): EnterprisePostgresPendingWorkRef {
  const rowCellId = requiredText(row.cell_id);
  if (rowCellId !== cellId) {
    throw new Error("Enterprise pending work row cell mismatch");
  }
  const tenantId = requiredText(row.tenant_id);
  const resourceId = requiredText(row.resource_id);
  if (row.work_kind === "tenant_lifecycle" || row.work_kind === "audit_export") {
    return {
      cellId,
      tenantId,
      workKind: row.work_kind,
      resourceId,
      actorUserId: enterprisePostgresAccountSubjectId(row.actor_id),
    };
  }
  if ((row.work_kind === "outbox" || row.work_kind === "screen_share" ||
    row.work_kind === "data_lifecycle" ||
    row.work_kind === "billing_lifecycle") &&
    row.actor_id == null) {
    return { cellId, tenantId, workKind: row.work_kind, resourceId };
  }
  throw new Error("Invalid enterprise pending work row");
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise pending work row");
  }
  return value;
}

function assertLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Invalid enterprise pending work limit");
  }
}

function assertTimestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid enterprise pending work timestamp");
  }
}

function assertCellId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(value)) {
    throw new Error("Invalid enterprise pending work cellId");
  }
}
import { randomUUID } from "node:crypto";
