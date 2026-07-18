import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseOutboxEventRecord } from
  "../../modules/enterprise/enterprise-event-record.js";
import type { EnterpriseMeetingScreenShareRuntime } from
  "../../modules/enterprise/enterprise-meeting-screen-share-runtime.js";
import {
  canEnterpriseParticipantShare,
  type EnterpriseMeetingScreenShareRecord,
  type EnterpriseMeetingScreenShareRevocation,
} from "../../modules/enterprise/enterprise-meeting-screen-share.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import {
  withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

type Runtime = Pick<EnterpriseMeetingScreenShareRuntime,
  "currentMeetingScreenShare" | "acquireMeetingScreenShare" |
  "commandMeetingScreenShare">;

export function createEnterprisePostgresMeetingScreenShareRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    currentMeetingScreenShare(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const scope = await meetingScope(unit, input.meetingId, true);
        if (!scope) return { status: "not_found" as const };
        if (!routeReady(scope)) {
          const revoked = await unit.meetingScreenShares.fence(
            input.meetingId, input.now,
          );
          await recordRevocations(unit, input.context, revoked, input.now);
          return { status: "route_not_ready" as const, revoked };
        }
        if (!["provisioning", "active"].includes(scope.meeting.status)) {
          const revoked = await unit.meetingScreenShares.fence(
            input.meetingId, input.now,
          );
          await recordRevocations(unit, input.context, revoked, input.now);
          return { status: "ready" as const, share: null, revoked };
        }
        const result = await unit.meetingScreenShares.current({
          meetingId: input.meetingId,
          now: input.now,
          maxPauseSeconds: enterpriseMeetingScreenShareMaxPauseSeconds(),
        });
        await recordRevocations(unit, input.context, result.revoked, input.now);
        return { status: "ready" as const, ...result };
      });
    },

    acquireMeetingScreenShare(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const scope = await meetingScope(unit, input.meetingId, true);
        if (!scope) return { status: "not_found" as const };
        if (!routeReady(scope)) {
          const revoked = await unit.meetingScreenShares.fence(
            input.meetingId, input.now,
          );
          await recordRevocations(unit, input.context, revoked, input.now);
          return { status: "route_not_ready" as const, revoked };
        }
        const participant = await activeParticipant(
          unit, input.meetingId, input.context.actorUserId,
        );
        if (!participant) return { status: "forbidden" as const };
        if (!canEnterpriseParticipantShare({
          participantRole: participant.role,
          screenShareRole: scope.meeting.policy.screenShareRole,
        })) return { status: "policy_denied" as const };
        const entitlement = await screenShareEntitlement(
          unit, input.now, input.includesSystemAudio,
        );
        if (entitlement.status !== "allowed") return entitlement;
        const prior = await unit.meetingScreenShares.replayAcquire(
          input.meetingId, input.idempotencyKey, input.requestHash,
        );
        if (prior) {
          if (prior.status === "replayed" &&
            prior.share.participantId !== participant.id) {
            return { status: "forbidden" as const };
          }
          return prior.status === "replayed" && prior.share.status !== "active"
            ? { status: "conflict" as const }
            : prior;
        }
        if (scope.meeting.version !== input.expectedMeetingVersion) {
          return { status: "conflict" as const };
        }
        let meeting = scope.meeting;
        if (meeting.status === "provisioning") {
          const activated = await unit.meetings.transition({
            meetingId: meeting.id,
            status: "active",
            expectedVersion: meeting.version,
            occurredAt: input.now.toISOString(),
          });
          if (activated.status !== "updated") {
            return { status: "conflict" as const };
          }
          meeting = activated.meeting;
          await recordMeetingStarted(unit, input.context, meeting.id, input.now);
        }
        if (meeting.status !== "active") {
          return { status: "not_joinable" as const };
        }
        const activeCount = await unit.meetingScreenShares.activeCount({
          now: input.now,
          maxPauseSeconds: enterpriseMeetingScreenShareMaxPauseSeconds(),
        });
        if (activeCount >= entitlement.limit) {
          return { status: "capacity_denied" as const };
        }
        const result = await unit.meetingScreenShares.acquire({
          id: input.shareId,
          meetingId: meeting.id,
          participantId: participant.id,
          communicationSessionId: scope.binding.communicationSessionId,
          routeEpoch: scope.binding.routeEpoch,
          sourceType: input.sourceType,
          includesSystemAudio: input.includesSystemAudio,
          qualityMode: input.qualityMode,
          expectedMeetingVersion: input.expectedMeetingVersion,
          actorId: input.context.actorUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          now: input.now,
          leaseSeconds: leaseSeconds(),
          maxPauseSeconds: enterpriseMeetingScreenShareMaxPauseSeconds(),
        });
        await recordRevocations(unit, input.context, result.revoked, input.now);
        if (result.status === "created") {
          await recordState(unit, input.context, result.share, "acquire", input.now);
        }
        return result;
      });
    },

    commandMeetingScreenShare(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const scope = await meetingScope(unit, input.meetingId, true);
        if (!scope) return { status: "not_found" as const };
        const share = await unit.meetingScreenShares.find(
          input.meetingId, input.shareId, true,
        );
        if (!share) return { status: "not_found" as const };
        const participant = await activeParticipant(
          unit, input.meetingId, input.context.actorUserId,
        );
        if (!participant || participant.id !== share.participantId) {
          return { status: "forbidden" as const };
        }
        if (input.command !== "stop" && (!routeReady(scope) ||
          !["provisioning", "active"].includes(scope.meeting.status))) {
          const revoked = await unit.meetingScreenShares.fence(
            input.meetingId, input.now,
          );
          await recordRevocations(unit, input.context, revoked, input.now);
          return { status: "route_not_ready" as const, revoked };
        }
        if (["resume", "renew"].includes(input.command)) {
          const entitlement = await screenShareEntitlement(
            unit, input.now, share.includesSystemAudio,
          );
          if (entitlement.status !== "allowed") return entitlement;
        }
        const result = await unit.meetingScreenShares.mutate({
          meetingId: input.meetingId,
          shareId: input.shareId,
          command: input.command,
          expectedVersion: input.expectedVersion,
          ...(input.trackSid ? { trackSid: input.trackSid } : {}),
          actorId: input.context.actorUserId,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          now: input.now,
          leaseSeconds: leaseSeconds(),
          maxPauseSeconds: enterpriseMeetingScreenShareMaxPauseSeconds(),
        });
        await recordRevocations(unit, input.context, result.revoked, input.now);
        if (result.status === "updated") {
          await recordState(unit, input.context, result.share, input.command, input.now);
        }
        return result;
      });
    },
  };
}

async function meetingScope(
  unit: EnterprisePostgresUnitOfWork,
  meetingId: string,
  lock: boolean,
) {
  const tenant = await unit.tenant.findTenant({ lock });
  const meeting = await unit.meetings.find(meetingId, lock);
  const binding = await unit.communicationBindings.findByBusiness(
    "meeting", meetingId,
  );
  return tenant && meeting && binding ? { tenant, meeting, binding } : null;
}

function routeReady(scope: NonNullable<Awaited<ReturnType<typeof meetingScope>>>) {
  return scope.tenant.status === "active" && Boolean(scope.tenant.cellId) &&
    scope.binding.kind === "meeting" &&
    scope.binding.homeRegion === scope.tenant.homeRegion &&
    scope.binding.cellId === scope.tenant.cellId &&
    scope.binding.routeEpoch === scope.tenant.version &&
    ["ready", "active", "degraded", "captions_only", "half_duplex"]
      .includes(scope.binding.status);
}

async function activeParticipant(
  unit: EnterprisePostgresUnitOfWork,
  meetingId: string,
  actorUserId: string,
) {
  const participant = await unit.meetings.participantByUser(
    meetingId, actorUserId,
  );
  return participant?.joinedAt && !participant.leftAt ? participant : null;
}

async function screenShareEntitlement(
  unit: EnterprisePostgresUnitOfWork,
  now: Date,
  includesSystemAudio: boolean,
) {
  const state = await unit.billingEntitlements.current(now);
  if (!state) return { status: "entitlement_not_ready" as const };
  const feature = state.entitlement.entitlements["meeting.screen_share.concurrent"];
  if (!feature) return { status: "entitlement_not_ready" as const };
  if (!feature.enabled) return { status: "policy_denied" as const };
  if (includesSystemAudio) {
    const audio = state.entitlement.entitlements["meeting.screen_share.system_audio"];
    if (!audio?.enabled) return { status: "policy_denied" as const };
  }
  return { status: "allowed" as const,
    limit: feature.limit ?? Number.MAX_SAFE_INTEGER };
}

async function recordState(
  unit: EnterprisePostgresUnitOfWork,
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
  share: EnterpriseMeetingScreenShareRecord,
  command: "acquire" | "pause" | "resume" | "renew" | "stop",
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
      command === "stop" ? "stopped" : `${command}d`}`,
    idempotencyKey: `screen-share-state:${share.id}:v${share.version}`,
    payload: { meetingId: share.meetingId, shareId: share.id,
      participantId: share.participantId, generation: share.generation,
      status: share.status },
    now,
  }));
}

async function recordRevocations(
  unit: EnterprisePostgresUnitOfWork,
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
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

async function recordMeetingStarted(
  unit: EnterprisePostgresUnitOfWork,
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
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
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"];
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

function leaseSeconds() {
  return integerEnv("ENTERPRISE_MEETING_SCREEN_SHARE_LEASE_SECONDS", 30, 15, 120);
}
export function enterpriseMeetingScreenShareMaxPauseSeconds() {
  return integerEnv("ENTERPRISE_MEETING_SCREEN_SHARE_MAX_PAUSE_SECONDS", 300, 30, 3_600);
}
function integerEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}
