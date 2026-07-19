import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseOutboxEventRecord } from
  "../../modules/enterprise/enterprise-event-record.js";
import type {
  EnterpriseMeetingScreenShareRecord,
  EnterpriseMeetingScreenShareRevocation,
} from "../../modules/enterprise/enterprise-meeting-screen-share.js";
import type { EnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export async function recordScreenShareState(
  unit: EnterprisePostgresUnitOfWork,
  context: EnterpriseTenantContext,
  share: EnterpriseMeetingScreenShareRecord,
  command: "acquire" | "pause" | "resume" | "renew" | "stop" | "force_stop",
  now: Date,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context,
    action: `meeting.screen_share.${command}`,
    resourceType: "screen_share",
    resourceId: share.id,
    result: "completed",
    details: {
      meetingId: share.meetingId,
      participantId: share.participantId,
      status: share.status,
      generation: share.generation,
      version: share.version,
    },
    createdAt: now.toISOString(),
  }));
  if (command === "renew") return;
  await unit.events.insertOutbox(outbox({
    context, shareId: share.id,
    eventType: `meeting.screen_share.${command === "acquire" ? "started" :
      command === "stop" ? "stopped" :
      command === "force_stop" ? "force_stopped" : `${command}d`}`,
    idempotencyKey: `screen-share-state:${share.id}:v${share.version}`,
    payload: { meetingId: share.meetingId, shareId: share.id,
      participantId: share.participantId, generation: share.generation,
      status: share.status },
    now,
  }));
}

export async function recordScreenShareRevocations(
  unit: EnterprisePostgresUnitOfWork,
  context: EnterpriseTenantContext,
  revocations: EnterpriseMeetingScreenShareRevocation[],
  now: Date,
) {
  for (const item of revocations) {
    await unit.events.insertOutbox(outbox({
      context, shareId: item.shareId,
      eventType: "meeting.screen_share.revoke.requested",
      idempotencyKey: `screen-share-revoke:${item.shareId}:g${item.generation}`,
      payload: item,
      now,
    }));
  }
}

export async function recordScreenShareMeetingStarted(
  unit: EnterprisePostgresUnitOfWork,
  context: EnterpriseTenantContext,
  meetingId: string,
  now: Date,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context, action: "meeting.start", resourceType: "meeting",
    resourceId: meetingId, result: "completed", createdAt: now.toISOString(),
  }));
  await unit.events.insertOutbox(outbox({
    context, shareId: meetingId, eventType: "meeting.started",
    aggregateType: "meeting",
    idempotencyKey: `meeting-started:${meetingId}`,
    payload: { meetingId }, now,
  }));
}

function outbox(input: {
  context: EnterpriseTenantContext;
  shareId: string; eventType: string; idempotencyKey: string;
  aggregateType?: "meeting" | "screen_share"; payload: unknown; now: Date;
}): EnterpriseOutboxEventRecord {
  const timestamp = input.now.toISOString();
  return {
    id: randomUUID(), tenantId: input.context.tenantId,
    aggregateType: input.aggregateType ?? "screen_share", aggregateId: input.shareId,
    eventType: input.eventType, idempotencyKey: input.idempotencyKey,
    payload: input.payload, traceId: input.context.traceId,
    attempts: 0, availableAt: timestamp, createdAt: timestamp,
  };
}
