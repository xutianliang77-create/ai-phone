import type {
  EnterpriseDataSnapshot,
} from "./enterprise-postgres-data-manifest.js";

export const dataTenantId = "00000000-0000-4000-8000-000000000001";
export const dataActorId = "user_00000000-0000-4000-8000-000000000002";
export const dataNow = "2026-07-17T01:00:00.000Z";

export function enterpriseDataTestSnapshot(): EnterpriseDataSnapshot {
  return {
    enterpriseTenants: [{
      id: dataTenantId,
      name: "Acme",
      status: "active",
      homeRegion: "cn-east-1",
      cellId: "cell-cn-1",
      planCode: "enterprise",
      dataRetentionDays: 365,
      createdAt: dataNow,
      updatedAt: dataNow,
      version: 1,
    }],
    enterpriseMembers: [{
      id: "00000000-0000-4000-8000-000000000003",
      tenantId: dataTenantId,
      userId: dataActorId,
      role: "owner",
      status: "active",
      joinedAt: dataNow,
      createdAt: dataNow,
      updatedAt: dataNow,
      version: 1,
    }],
    enterpriseTenantJobs: [{
      id: "00000000-0000-4000-8000-000000000004",
      tenantId: dataTenantId,
      actorUserId: dataActorId,
      type: "tenant.suspend",
      idempotencyKey: "suspend-acme",
      requestHash: "a".repeat(64),
      status: "completed",
      attempts: 1,
      completedAt: dataNow,
      createdAt: dataNow,
      updatedAt: dataNow,
    }],
    enterpriseAuditEvents: [{
      id: "00000000-0000-4000-8000-000000000005",
      tenantId: dataTenantId,
      actorUserId: dataActorId,
      action: "tenant.suspend",
      resourceType: "tenant",
      resourceId: dataTenantId,
      result: "completed",
      details: { source: "migration", attempt: 1 },
      traceId: "trace-data",
      createdAt: dataNow,
    }],
    enterpriseInboxEvents: [{
      id: "00000000-0000-4000-8000-000000000006",
      tenantId: dataTenantId,
      source: "provider",
      sourceEventId: "provider-event-1",
      eventType: "provider.received",
      payloadHash: "b".repeat(64),
      payload: { value: 1 },
      traceId: "trace-data",
      receivedAt: dataNow,
      processedAt: dataNow,
    }],
    enterpriseOutboxEvents: [{
      id: "00000000-0000-4000-8000-000000000007",
      tenantId: dataTenantId,
      aggregateType: "tenant",
      aggregateId: dataTenantId,
      eventType: "tenant.suspended",
      idempotencyKey: "tenant-suspended-acme",
      payload: { tenantId: dataTenantId },
      traceId: "trace-data",
      attempts: 1,
      availableAt: dataNow,
      createdAt: dataNow,
      publishedAt: dataNow,
    }],
  };
}
