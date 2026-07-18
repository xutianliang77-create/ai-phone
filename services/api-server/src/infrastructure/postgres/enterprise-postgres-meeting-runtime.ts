import type { EnterpriseMeetingAggregate } from
  "../../modules/enterprise/enterprise-meeting.js";
import type { EnterpriseMeetingRepositoryRuntime } from
  "../../modules/enterprise/enterprise-meeting-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresMeetingRuntime(
  pool: EnterpriseTenantPostgresPool,
): EnterpriseMeetingRepositoryRuntime {
  return {
    createMeeting(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetings.create(input.meeting);
        if (result.status !== "created") return result;
        return {
          status: "created",
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
