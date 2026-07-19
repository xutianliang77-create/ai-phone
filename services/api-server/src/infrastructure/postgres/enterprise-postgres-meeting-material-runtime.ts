import { createHash, randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMeetingMaterialRuntime } from
  "../../modules/enterprise/enterprise-meeting-material-runtime.js";
import type { EnterpriseMeetingMaterialSourceSegment } from
  "../../modules/enterprise/enterprise-meeting-material.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresMeetingMaterialRuntime(
  pool: EnterpriseTenantPostgresPool,
): EnterpriseMeetingMaterialRuntime {
  return {
    prepareMeetingMaterial(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const rawSegments = await unit.meetingMaterials.sourceSegments(input.meetingId);
        const sourceHash = digest(rawSegments);
        const prepared = await unit.meetingMaterials.prepare({
          runId: randomUUID(), meetingId: input.meetingId,
          expectedMeetingVersion: input.expectedMeetingVersion,
          sourceEventCount: rawSegments.length, sourceHash,
          idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
          createdAt: input.occurredAt,
        });
        if (prepared.status !== "created" && prepared.status !== "replayed") {
          return prepared;
        }
        if ("finalized" in prepared && prepared.finalized && prepared.material) {
          return { status: "replayed" as const, run: prepared.run,
            material: prepared.material, finalized: true as const };
        }
        if (prepared.run.sourceHash !== sourceHash ||
          prepared.run.sourceEventCount !== rawSegments.length) {
          return { status: "conflict" as const };
        }
        return {
          status: prepared.status, run: prepared.run, finalized: false as const,
          segments: rawSegments.map((segment, index) => ({
            ...segment,
            id: deterministicSegmentId(prepared.run.id, segment, index),
          })),
        };
      });
    },

    finalizeMeetingMaterial(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetingMaterials.finalize(input);
        if (result.status !== "finalized") return result;
        const run = result.material.run;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context,
          action: "meeting.material.generate",
          resourceType: "meeting_material",
          resourceId: run.id,
          result: "completed",
          details: {
            meetingId: run.meetingId,
            revision: run.revision,
            sourceEventCount: run.sourceEventCount,
            reviewStatus: run.reviewStatus,
            version: run.version,
          },
          createdAt: input.occurredAt,
        }));
        await insertMaterialOutbox(unit, input.context, {
          eventType: "enterprise.meeting.material.ready",
          runId: run.id,
          meetingId: run.meetingId,
          revision: run.revision,
          occurredAt: input.occurredAt,
        });
        return result;
      });
    },

    currentMeetingMaterial(input) {
      return withEnterprisePostgresUnitOfWork(
        pool, input.context,
        (unit) => unit.meetingMaterials.current(input.meetingId),
      );
    },

    publishMeetingMaterial(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetingMaterials.publish(input);
        if (result.status !== "published" || result.replayed) return result;
        const run = result.material.run;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context,
          action: "meeting.material.publish",
          resourceType: "meeting_material",
          resourceId: run.id,
          result: "completed",
          details: { meetingId: run.meetingId, revision: run.revision,
            version: run.version },
          createdAt: input.occurredAt,
        }));
        await insertMaterialOutbox(unit, input.context, {
          eventType: "enterprise.meeting.material.published",
          runId: run.id, meetingId: run.meetingId, revision: run.revision,
          occurredAt: input.occurredAt,
        });
        return result;
      });
    },

    updateMeetingMaterialSpeaker(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetingMaterials.updateSpeaker(input);
        if (result.status !== "updated") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "meeting.material.speaker_label.update",
          resourceType: "meeting_material", resourceId: input.runId,
          result: "completed",
          details: { meetingId: input.meetingId,
            participantId: input.participantId,
            version: result.material.run.version },
          createdAt: input.occurredAt,
        }));
        return result;
      });
    },

    updateMeetingMaterialAction(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.meetingMaterials.updateAction(input);
        if (result.status !== "updated") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "meeting.material.action.update",
          resourceType: "meeting_action_item", resourceId: input.actionItemId,
          result: "completed",
          details: { meetingId: input.meetingId, materialRunId: input.runId,
            status: input.status }, createdAt: input.occurredAt,
        }));
        return result;
      });
    },

    endMeetingForMaterials(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const meeting = await unit.meetings.find(input.meetingId, true);
        if (!meeting) return { status: "not_found" as const };
        if (!canManage(input.context, meeting.hostUserId)) {
          return { status: "forbidden" as const };
        }
        if (meeting.status === "ended") {
          return { status: "ended" as const, meetingVersion: meeting.version };
        }
        if (meeting.version !== input.expectedVersion) {
          return { status: "conflict" as const };
        }
        const now = new Date(input.occurredAt);
        const currentShare = await unit.meetingScreenShares.current({
          meetingId: meeting.id, now, maxPauseSeconds: 300,
        });
        if (currentShare.share) return { status: "screen_share_active" as const };
        const ending = await unit.meetings.transition({
          meetingId: meeting.id, status: "ending",
          expectedVersion: meeting.version, occurredAt: input.occurredAt,
        });
        if (ending.status !== "updated") return ending;
        const ended = await unit.meetings.transition({
          meetingId: meeting.id, status: "ended",
          expectedVersion: ending.meeting.version, occurredAt: input.occurredAt,
        });
        if (ended.status !== "updated") return ended;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "meeting.end",
          resourceType: "meeting", resourceId: meeting.id,
          result: "completed", details: { version: ended.meeting.version },
          createdAt: input.occurredAt,
        }));
        await insertMaterialOutbox(unit, input.context, {
          eventType: "enterprise.meeting.ended",
          meetingId: meeting.id, revision: ended.meeting.version,
          occurredAt: input.occurredAt,
        });
        return { status: "ended" as const, meetingVersion: ended.meeting.version };
      });
    },
  };
}

type Unit = Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0];
async function insertMaterialOutbox(
  unit: Unit,
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
  input: {
    eventType: string; runId?: string; meetingId: string;
    revision: number; occurredAt: string;
  },
) {
  await unit.events.insertOutbox({
    id: randomUUID(), tenantId: context.tenantId,
    aggregateType: "meeting", aggregateId: input.meetingId,
    eventType: input.eventType,
    idempotencyKey: `${input.eventType}:${input.runId ?? input.meetingId}:v${input.revision}`,
    payload: { meetingId: input.meetingId,
      ...(input.runId ? { materialRunId: input.runId } : {}),
      revision: input.revision }, traceId: context.traceId,
    attempts: 0, availableAt: input.occurredAt,
    createdAt: input.occurredAt,
  });
}

function deterministicSegmentId(
  runId: string,
  segment: Omit<EnterpriseMeetingMaterialSourceSegment, "id">,
  ordinal: number,
) {
  const bytes = createHash("sha256").update(JSON.stringify({
    runId, ordinal, participant: segment.sourceParticipantId,
    track: segment.sourceTrackSid, segment: segment.sourceSegmentId,
    revision: segment.revision,
  })).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function canManage(
  context: { actorUserId: string; actorRole?: string },
  hostUserId: string,
) {
  return context.actorUserId === hostUserId ||
    context.actorRole === "owner" || context.actorRole === "admin";
}
