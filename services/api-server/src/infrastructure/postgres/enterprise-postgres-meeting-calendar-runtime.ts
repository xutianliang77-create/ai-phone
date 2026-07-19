import { createHash, randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMeetingCalendarCommandService } from
  "../../modules/enterprise/enterprise-meeting-calendar-command.js";
import { createEnvironmentEnterpriseMeetingCalendarCommandService } from
  "../../modules/enterprise/enterprise-meeting-calendar-command.js";
import type { EnterpriseMeetingCalendarRuntime } from
  "../../modules/enterprise/enterprise-meeting-calendar-runtime.js";
import type { EnterpriseMeetingCalendarPublishReceipt } from
  "../../modules/enterprise/enterprise-meeting-calendar.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnvironmentEnterprisePostgresMeetingCalendarRuntime(
  pool: EnterpriseTenantPostgresPool,
) {
  return createEnterprisePostgresMeetingCalendarRuntime(
    pool, createEnvironmentEnterpriseMeetingCalendarCommandService(),
  );
}

export function createEnterprisePostgresMeetingCalendarRuntime(
  pool: EnterpriseTenantPostgresPool,
  command: EnterpriseMeetingCalendarCommandService,
): EnterpriseMeetingCalendarRuntime {
  return {
    currentMeetingCalendarSync(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const meeting = await unit.meetings.find(input.meetingId, false);
        if (!meeting) return { status: "not_found" as const };
        if (meeting.hostUserId !== input.context.actorUserId) {
          return { status: "forbidden" as const };
        }
        return { status: "ready" as const,
          sync: await unit.meetingCalendar.current(input.meetingId) };
      });
    },

    requestMeetingCalendarSync(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const meeting = await unit.meetings.find(input.meetingId, true);
        if (!meeting) return { status: "not_found" as const };
        if (meeting.hostUserId !== input.context.actorUserId) {
          return { status: "forbidden" as const };
        }
        const requestHash = digest({ actorUserId: input.context.actorUserId,
          meetingId: input.meetingId,
          expectedMeetingVersion: input.expectedMeetingVersion,
          durationMinutes: input.durationMinutes });
        const replay = await unit.meetingCalendar.byIdempotency(
          input.meetingId, input.idempotencyKey,
        );
        if (replay) return replay.requestHash === requestHash &&
          replay.createdBy === input.context.actorUserId
          ? { status: "replayed" as const, sync: replay }
          : { status: "idempotency_conflict" as const };
        if (meeting.version !== input.expectedMeetingVersion) {
          return { status: "conflict" as const };
        }
        if (meeting.status !== "scheduled" || !meeting.scheduledAt ||
          Date.parse(meeting.scheduledAt) <= input.now.getTime()) {
          return { status: "not_scheduled" as const };
        }
        if (!Number.isSafeInteger(input.durationMinutes) ||
          input.durationMinutes < 15 || input.durationMinutes > 480) {
          throw new Error("Invalid meeting calendar duration");
        }
        const syncId = randomUUID();
        const outboxEventId = randomUUID();
        const scheduledEndAt = new Date(Date.parse(meeting.scheduledAt) +
          input.durationMinutes * 60_000).toISOString();
        const prepared = command.prepare({ tenantId: input.context.tenantId,
          syncId, meetingId: meeting.id, title: meeting.title,
          scheduledStartAt: meeting.scheduledAt, scheduledEndAt });
        if (prepared.status !== "ready") return { status: "not_configured" as const,
          reasonCode: prepared.reasonCode };
        const created = await unit.meetingCalendar.create({ id: syncId,
          meetingId: meeting.id, provider: prepared.provider,
          scheduledStartAt: meeting.scheduledAt, scheduledEndAt,
          providerEventKey: prepared.providerEventKey, requestHash,
          idempotencyKey: input.idempotencyKey, outboxEventId,
          now: input.now.toISOString() });
        if (created.status !== "created") return created.status === "replayed"
          ? created
          : { status: created.status };
        const event = await unit.events.insertOutbox({ id: outboxEventId,
          tenantId: input.context.tenantId, aggregateType: "meeting_calendar_sync",
          aggregateId: syncId, eventType: "meeting.calendar.create.requested",
          idempotencyKey: `meeting-calendar-sync:${syncId}`,
          payload: prepared.outboxPayload, traceId: input.context.traceId,
          attempts: 0, availableAt: input.now.toISOString(),
          createdAt: input.now.toISOString() });
        if (event.status !== "created") throw new Error(
          "Meeting calendar outbox event already exists",
        );
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "meeting.calendar_sync.request",
          resourceType: "meeting_calendar_sync", resourceId: syncId,
          result: "completed", details: { meetingId: meeting.id,
            provider: prepared.provider, scheduledStartAt: meeting.scheduledAt,
            scheduledEndAt }, createdAt: input.now.toISOString(),
        }));
        return created;
      });
    },

    finalizeMeetingCalendarOutbox(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const sync = await unit.meetingCalendar.byOutboxEvent(input.eventId);
        if (!sync || sync.status !== "pending") return { status: "conflict" as const };
        const normalized = normalizeResult(input.result, sync.id);
        const updated = await unit.meetingCalendar.finalize({ syncId: sync.id,
          outboxEventId: input.eventId, attempt: input.attempt,
          result: normalized.sync, now: input.now.toISOString() });
        if (updated.status !== "updated") return { status: "conflict" as const };
        const retryAt = new Date(input.now.getTime() +
          Math.min(1_000 * 2 ** Math.max(0, input.attempt - 1), 300_000))
          .toISOString();
        const event = await unit.events.finalizeOutbox({ eventId: input.eventId,
          attempt: input.attempt,
          availableAt: normalized.published ? input.now.toISOString() : retryAt,
          ...(normalized.published
            ? { publishedAt: input.now.toISOString() }
            : { lastErrorCode: normalized.reasonCode }) });
        if (event.status !== "updated") throw new Error(
          "Meeting calendar outbox finalize conflict",
        );
        if (normalized.published) await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: normalized.sync.status === "synced"
              ? "meeting.calendar_sync.complete" : "meeting.calendar_sync.fail",
            resourceType: "meeting_calendar_sync", resourceId: sync.id,
            result: normalized.sync.status === "synced" ? "completed" : "failed",
            details: { meetingId: sync.meetingId, provider: sync.provider,
              attempts: input.attempt,
              ...("reasonCode" in normalized
                ? { reasonCode: normalized.reasonCode } : {}) },
            createdAt: input.now.toISOString() }),
        );
        return { status: normalized.published ? "completed" as const
          : "retried" as const };
      });
    },
  };
}

function normalizeResult(
  result: Parameters<NonNullable<EnterpriseMeetingCalendarRuntime[
    "finalizeMeetingCalendarOutbox"]>>[0]["result"],
  syncId: string,
) {
  if (result.status === "retry") {
    const reasonCode = code(result.reason);
    return { published: false as const, reasonCode,
      sync: { status: "retry" as const, reasonCode } };
  }
  const receipt = result.receipt;
  if (!receipt || receipt.kind !== "meeting_calendar" || receipt.syncId !== syncId) {
    const reasonCode = "calendar_provider_receipt_invalid";
    return { published: false as const, reasonCode,
      sync: { status: "retry" as const, reasonCode } };
  }
  return receipt.outcome === "synced" ? synced(receipt) : {
    published: true as const, reasonCode: code(receipt.reasonCode),
    sync: { status: "failed" as const, reasonCode: code(receipt.reasonCode) },
  };
}
function synced(receipt: Extract<EnterpriseMeetingCalendarPublishReceipt,
  { outcome: "synced" }>) {
  return { published: true as const,
    sync: { status: "synced" as const,
      providerEventId: receipt.providerEventId,
      providerEventEtag: receipt.providerEventEtag,
      providerWebUrl: receipt.providerWebUrl,
      providerResponseHash: receipt.providerResponseHash } };
}
function code(value: string) { return /^[a-z][a-z0-9_]{1,63}$/.test(value)
  ? value : "calendar_provider_failed"; }
function digest(value: unknown) { return createHash("sha256")
  .update(JSON.stringify(value)).digest("hex"); }
