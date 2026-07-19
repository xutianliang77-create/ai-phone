import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { isTerminalEnterpriseCommunicationStatus } from
  "../../modules/enterprise/enterprise-communication-session.js";
import type { EnterpriseMeetingAggregate } from
  "../../modules/enterprise/enterprise-meeting.js";
import type { EnterpriseMeetingRepositoryRuntime } from
  "../../modules/enterprise/enterprise-meeting-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterprisePostgresMeetingSession } from
  "./enterprise-postgres-meeting-create.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresMeetingRuntime(
  pool: EnterpriseTenantPostgresPool,
): EnterpriseMeetingRepositoryRuntime {
  return {
    createMeeting(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetings.create(input.meeting);
        if (result.status === "idempotency_conflict") return result;
        return {
          status: result.status,
          aggregate: await aggregate(unit, result.meeting),
        };
      });
    },
    getMeeting(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const meeting = await unit.meetings.find(input.meetingId);
        return meeting
          ? { status: "ready", aggregate: await aggregate(unit, meeting) }
          : { status: "not_found" };
      });
    },
    listMeetings(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready",
        meetings: await aggregates(unit, await unit.meetings.list()),
      }));
    },
    addMeetingParticipant(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetings.addParticipant(input.participant);
        if (result.status !== "created") return result;
        const meeting = await unit.meetings.find(result.participant.meetingId);
        if (!meeting) throw new Error("Created meeting participant lost meeting");
        return { status: "created", aggregate: await aggregate(unit, meeting) };
      });
    },
    addMeetingArtifact(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetings.addArtifact(input.artifact);
        if (result.status !== "created") return result;
        const meeting = await unit.meetings.find(result.artifact.meetingId);
        if (!meeting) throw new Error("Created meeting artifact lost meeting");
        return { status: "created", aggregate: await aggregate(unit, meeting) };
      });
    },
    transitionMeeting(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetings.transition(input);
        if (result.status !== "updated") return result;
        return {
          status: "updated",
          aggregate: await aggregate(unit, result.meeting),
        };
      });
    },
    listRecoverableMeetings(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready",
        meetings: await aggregates(unit, await unit.meetings.list(true)),
      }));
    },
    createMeetingSession(input) {
      return createEnterprisePostgresMeetingSession(pool, input, aggregate);
    },
    inviteMeetingGuest(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const meeting = await unit.meetings.find(input.participant.meetingId, true);
        if (!meeting) return { status: "not_found" };
        if (!canManageMeeting(input.context, meeting.hostUserId) ||
          !meeting.policy.allowGuests) return { status: "forbidden" };
        if (!canIssueMeetingAccess(meeting.status, true)) {
          return { status: "not_joinable" };
        }
        const result = await unit.meetingInvitations.invite({
          id: input.participant.id,
          meetingId: input.participant.meetingId,
          externalIdentity: input.participant.externalIdentity ?? "",
          displayName: input.participant.displayName,
          ...(input.participant.language ? { language: input.participant.language } : {}),
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
        });
        if (result.status === "conflict") return result;
        if (result.status === "created") {
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "meeting.guest_invite",
            resourceType: "meeting",
            resourceId: meeting.id,
            result: "completed",
            details: { participantId: result.participant.id, role: "guest" },
          }));
        }
        return {
          status: result.status,
          participant: result.participant,
          aggregate: await aggregate(unit, meeting),
        };
      });
    },
    authorizeMemberMeetingJoin(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!canJoinAsMember(input.context.actorRole)) {
          return { status: "not_found" };
        }
        let meeting = await unit.meetings.find(input.meetingId, true);
        if (!meeting) return { status: "not_found" };
        const now = requiredTime(input.now);
        if (meeting.status === "scheduled") {
          if (meeting.hostUserId !== input.context.actorUserId ||
            !meeting.scheduledAt || Date.parse(meeting.scheduledAt) > now + 900_000) {
            return { status: "not_started" };
          }
          const transitioned = await unit.meetings.transition({
            meetingId: meeting.id, status: "provisioning",
            expectedVersion: meeting.version, occurredAt: input.now,
          });
          if (transitioned.status !== "updated") return { status: "not_ready" };
          meeting = transitioned.meeting;
        }
        if (!canIssueMeetingAccess(meeting.status)) {
          return { status: "not_joinable" };
        }
        let participant = await unit.meetings.participantByUser(
          meeting.id, input.context.actorUserId,
        );
        if (!participant) {
          const added = await unit.meetings.addParticipant({
            id: input.participantId ?? randomUUID(),
            meetingId: meeting.id,
            userId: input.context.actorUserId,
            role: meeting.hostUserId === input.context.actorUserId ? "host" : "member",
            displayName: input.displayName,
            ...(input.language ? { language: input.language } : {}),
          });
          participant = added.status === "created" ? added.participant :
            await unit.meetings.participantByUser(
              meeting.id, input.context.actorUserId,
            );
        }
        if (!participant) return { status: "not_ready" };
        const preference = await unit.meetingTranslations.updatePreference({
          meetingId: meeting.id,
          participantId: participant.id,
          captionLanguage: input.captionLanguage ?? participant.captionLanguage,
          translatedAudioEnabled: input.translatedAudioEnabled ??
            participant.translatedAudioEnabled,
          joinedAt: input.now,
        });
        if (preference.status !== "updated") return { status: "not_ready" };
        if (meeting.status === "provisioning") {
          const active = await unit.meetings.transition({
            meetingId: meeting.id, status: "active",
            expectedVersion: meeting.version, occurredAt: input.now,
          });
          if (active.status !== "updated") return { status: "not_ready" };
          meeting = active.meeting;
        }
        return authorize(unit, meeting, preference.participant);
      });
    },
    authorizeGuestMeetingJoin(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        requiredTime(input.now);
        let meeting = await unit.meetings.find(input.meetingId, true);
        if (!meeting) return { status: "not_found" };
        if (meeting.status === "scheduled") return { status: "not_started" };
        if (!meeting.policy.allowGuests || !canIssueMeetingAccess(meeting.status)) {
          return { status: "not_joinable" };
        }
        const participant = await unit.meetings.participantById(
          meeting.id, input.participantId,
        );
        if (!participant || participant.role !== "guest" ||
          input.context.actorUserId !== `guest:${participant.id}`) {
          return { status: "not_found" };
        }
        const preference = await unit.meetingTranslations.updatePreference({
          meetingId: meeting.id,
          participantId: participant.id,
          captionLanguage: input.captionLanguage ?? participant.captionLanguage,
          translatedAudioEnabled: input.translatedAudioEnabled ??
            participant.translatedAudioEnabled,
          joinedAt: input.now,
        });
        if (preference.status !== "updated") return { status: "not_ready" };
        if (meeting.status === "provisioning") {
          const active = await unit.meetings.transition({
            meetingId: meeting.id, status: "active",
            expectedVersion: meeting.version, occurredAt: input.now,
          });
          if (active.status !== "updated") return { status: "not_ready" };
          meeting = active.meeting;
        }
        return authorize(unit, meeting, preference.participant);
      });
    },
  };
}

type MeetingUnit = Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0];

async function aggregates(
  unit: MeetingUnit,
  meetings: EnterpriseMeetingAggregate["meeting"][],
) {
  return Promise.all(meetings.map((meeting) => aggregate(unit, meeting)));
}

async function aggregate(
  unit: MeetingUnit,
  meeting: EnterpriseMeetingAggregate["meeting"],
): Promise<EnterpriseMeetingAggregate> {
  const [participants, artifacts, binding] = await Promise.all([
    unit.meetings.participants(meeting.id),
    unit.meetings.artifacts(meeting.id),
    unit.communicationBindings.findByBusiness("meeting", meeting.id),
  ]);
  return {
    meeting,
    participants,
    artifacts,
    ...(binding ? { communicationBinding: binding } : {}),
  };
}

async function authorize(
  unit: MeetingUnit,
  meeting: EnterpriseMeetingAggregate["meeting"],
  participant: EnterpriseMeetingAggregate["participants"][number],
) {
  const [tenant, binding] = await Promise.all([
    unit.tenant.findTenant(),
    unit.communicationBindings.findByBusiness("meeting", meeting.id),
  ]);
  if (!tenant || tenant.status !== "active" || !tenant.cellId || !binding ||
    binding.homeRegion !== tenant.homeRegion || binding.cellId !== tenant.cellId ||
    binding.routeEpoch !== tenant.version ||
    isTerminalEnterpriseCommunicationStatus(binding.status)) {
    return { status: "not_ready" as const };
  }
  return {
    status: "authorized" as const,
    authorization: {
      aggregate: await aggregate(unit, meeting), participant, binding,
      routing: {
        homeRegion: tenant.homeRegion,
        cellId: tenant.cellId,
        routeEpoch: tenant.version,
      },
    },
  };
}

function canManageMeeting(
  context: Parameters<NonNullable<
    EnterpriseMeetingRepositoryRuntime["createMeetingSession"]
  >>[0]["context"],
  hostUserId: string,
) {
  return context.actorUserId === hostUserId ||
    context.actorRole === "owner" || context.actorRole === "admin";
}
function canJoinAsMember(role: Parameters<NonNullable<
  EnterpriseMeetingRepositoryRuntime["createMeetingSession"]
>>[0]["context"]["actorRole"]) {
  return role !== undefined && [
    "owner", "admin", "meeting_host", "member",
  ].includes(role);
}
function canIssueMeetingAccess(status: string, allowScheduled = false) {
  return ["provisioning", "active", ...(allowScheduled ? ["scheduled"] : [])]
    .includes(status);
}
function requiredTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
    throw new Error("Invalid meeting join time");
  }
  return time;
}
