import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseOutboxEventRecord } from
  "../../modules/enterprise/enterprise-event-record.js";
import type { EnterpriseMeetingAggregate } from
  "../../modules/enterprise/enterprise-meeting.js";
import type { EnterpriseMeetingRepositoryRuntime } from
  "../../modules/enterprise/enterprise-meeting-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import {
  withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

type CreateSessionInput = Parameters<NonNullable<
  EnterpriseMeetingRepositoryRuntime["createMeetingSession"]
>>[0];
type AggregateLoader = (
  unit: EnterprisePostgresUnitOfWork,
  meeting: EnterpriseMeetingAggregate["meeting"],
) => Promise<EnterpriseMeetingAggregate>;

export async function createEnterprisePostgresMeetingSession(
  pool: EnterpriseTenantPostgresPool,
  input: CreateSessionInput,
  aggregate: AggregateLoader,
) {
  try {
    return await withEnterprisePostgresUnitOfWork(
      pool,
      input.context,
      async (unit) => {
        const prior = await unit.meetings.findByCreationKey(
          input.meeting.idempotencyKey,
        );
        if (prior) {
          return prior.requestHash === input.meeting.requestHash
            ? { status: "replayed" as const,
                aggregate: await aggregate(unit, prior.meeting) }
            : { status: "idempotency_conflict" as const };
        }
        const tenant = await unit.tenant.findTenant({ lock: true });
        if (!tenant || tenant.status !== "active" || !tenant.cellId) {
          return { status: "route_not_ready" as const };
        }
        const policyVersion = await unit.communicationPolicies
          .currentPublishedVersion();
        if (!policyVersion) return { status: "policy_not_ready" as const };
        if (!await unit.billingEntitlements.current(new Date(input.meeting.createdAt))) {
          return { status: "entitlement_not_ready" as const };
        }
        const created = await unit.meetings.create(input.meeting);
        if (created.status === "idempotency_conflict") return created;
        if (created.status === "replayed") {
          return { status: "replayed" as const,
            aggregate: await aggregate(unit, created.meeting) };
        }
        const host = await unit.meetings.addParticipant({
          id: input.hostParticipantId,
          meetingId: created.meeting.id,
          userId: input.context.actorUserId,
          role: "host",
          displayName: "会议主持人",
        });
        if (host.status !== "created") throw new Error("Meeting host conflict");
        const binding = await unit.communicationBindings.bind({
          bindingId: input.bindingId,
          communicationSessionId: input.communicationSessionId,
          kind: "meeting",
          businessId: created.meeting.id,
          homeRegion: tenant.homeRegion,
          cellId: tenant.cellId,
          routeEpoch: tenant.version,
          policyVersion,
          startedAt: input.meeting.createdAt,
        });
        if (binding.status === "entitlement_unavailable") {
          throw new MeetingCreateAbort("entitlement_not_ready");
        }
        await recordCreated(unit, input, created.meeting.id);
        return { status: "created" as const,
          aggregate: await aggregate(unit, created.meeting) };
      },
    );
  } catch (error) {
    if (error instanceof MeetingCreateAbort) return { status: error.status };
    throw error;
  }
}

async function recordCreated(
  unit: EnterprisePostgresUnitOfWork,
  input: CreateSessionInput,
  meetingId: string,
) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context: input.context,
    action: "meeting.create",
    resourceType: "meeting",
    resourceId: meetingId,
    result: "completed",
    details: { status: input.meeting.status },
    createdAt: input.meeting.createdAt,
  }));
  const event: EnterpriseOutboxEventRecord = {
    id: randomUUID(), tenantId: input.context.tenantId,
    aggregateType: "meeting", aggregateId: meetingId,
    eventType: "meeting.provision.requested",
    idempotencyKey: `meeting.provision:${meetingId}`,
    payload: { meetingId, communicationSessionId: input.communicationSessionId,
      scheduledAt: input.meeting.scheduledAt ?? null },
    traceId: input.context.traceId, attempts: 0,
    availableAt: input.meeting.scheduledAt ?? input.meeting.createdAt,
    createdAt: input.meeting.createdAt,
  };
  await unit.events.insertOutbox(event);
}

class MeetingCreateAbort extends Error {
  constructor(readonly status: "entitlement_not_ready") {
    super(status);
  }
}
