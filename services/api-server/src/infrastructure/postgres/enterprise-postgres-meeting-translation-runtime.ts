import type {
  EnterpriseMeetingTranslationDispatch,
  EnterpriseMeetingTranslationWorkerSnapshot,
} from "../../modules/enterprise/enterprise-meeting-runtime.js";
import { enterpriseMeetingRuntimeReadiness } from
  "../../modules/enterprise/enterprise-meeting-runtime-readiness.js";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import {
  issueEnterpriseWorkerDispatchTicket,
  verifyEnterpriseWorkerDispatchTicket,
  type EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Pick<EnterpriseRepositoryRuntime,
  "prepareMeetingTranslation" |
  "updateMeetingTranslationPreference" |
  "acceptMeetingTranslationWorker" |
  "heartbeatMeetingTranslationWorker" |
  "refreshMeetingTranslationWorker" |
  "publishMeetingTranslationEvents" |
  "finalizeMeetingTranslationWorker">;

export function createEnterprisePostgresMeetingTranslationRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    async prepareMeetingTranslation(input) {
      const now = validDate(input.now);
      const signingSecret = workerSigningSecret();
      if (!signingSecret) {
        return { status: "not_ready", reasonCode: "worker_signing_not_configured" };
      }
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const meeting = await unit.meetings.find(input.meetingId, true);
        if (!meeting) return notReady("meeting_not_found");
        const binding = await unit.communicationBindings.findByBusiness(
          "meeting", meeting.id,
        );
        if (!binding || binding.kind !== "meeting") {
          return notReady("meeting_binding_not_ready");
        }
        const resolution = await unit.communicationPolicies.resolve({
          communicationSessionId: binding.communicationSessionId,
          authorizationEvidenceIds: [],
          readiness: enterpriseMeetingRuntimeReadiness(process.env, now),
          now,
        });
        if (!("snapshot" in resolution) || !resolution.snapshot) {
          return notReady(resolution.status);
        }
        const snapshot = resolution.snapshot;
        if (snapshot.runtimeState === "blocked" ||
          !snapshot.allowedCapabilities.includes("translation_runtime")) {
          return notReady(snapshot.reasonCode);
        }
        const agentName = translationAgentName();
        const roomName = roomNameFor(binding.communicationSessionId);
        const issued = await unit.workerDispatches.issue({
          communicationSessionId: binding.communicationSessionId,
          capability: "translation_runtime",
          callId: meeting.id,
          roomName,
          provider: "livekit_dispatch",
          agentName,
          idempotencyKey: dispatchKey(meeting.id, binding.generation),
          leaseSeconds: leaseSeconds(),
          ticketTtlSeconds: ticketTtlSeconds(),
          now,
        });
        if (issued.status !== "created" && issued.status !== "replayed") {
          return notReady(issued.status);
        }
        if (Date.parse(issued.grant.expiresAt) <= now.getTime()) {
          return notReady("dispatch_ticket_expired");
        }
        const payload = payloadFor(issued.grant);
        return {
          status: "ready" as const,
          dispatch: {
            ticket: issueEnterpriseWorkerDispatchTicket({ payload, signingSecret }),
            meetingId: meeting.id,
            communicationSessionId: binding.communicationSessionId,
            roomName,
            agentName,
            generation: binding.generation,
            expiresAt: issued.grant.expiresAt,
            runtimeState: snapshot.runtimeState,
            reasonCode: snapshot.reasonCode,
          } satisfies EnterpriseMeetingTranslationDispatch,
        };
      });
    },

    updateMeetingTranslationPreference(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.meetingTranslations.updatePreference(input),
      );
    },

    acceptMeetingTranslationWorker(input) {
      return withWorkerTicket(pool, input, async (unit, payload) => {
        const accepted = await unit.workerDispatches.accept({
          payload, workerCellId: input.workerCellId, workerId: input.workerId,
          leaseSeconds: input.leaseSeconds, now: input.now,
        });
        if (accepted.status !== "accepted") return accepted;
        const authorized = await unit.workerDispatches.authorize({
          payload, workerCellId: input.workerCellId, workerId: input.workerId,
          now: input.now,
        });
        if (authorized.status !== "authorized" || !authorized.policy) {
          return authorized;
        }
        const meeting = await meetingForTicket(unit, payload);
        if (!meeting) return { status: "meeting_binding_mismatch" as const };
        return {
          status: "accepted" as const,
          snapshot: snapshotFor(meeting.id, payload, authorized.policy),
        };
      });
    },

    heartbeatMeetingTranslationWorker(input) {
      return withWorkerTicket(pool, input, (unit, payload) =>
        unit.workerDispatches.heartbeat({
          payload, workerCellId: input.workerCellId, workerId: input.workerId,
          leaseSeconds: input.leaseSeconds, now: input.now,
        }));
    },

    refreshMeetingTranslationWorker(input) {
      return withWorkerTicket(pool, input, async (unit, payload) => {
        const refreshed = await unit.workerDispatches.refresh({
          payload, workerCellId: input.workerCellId, workerId: input.workerId,
          leaseSeconds: input.leaseSeconds,
          ticketTtlSeconds: input.ticketTtlSeconds, now: input.now,
        });
        if (refreshed.status !== "accepted") return refreshed;
        const signingSecret = workerSigningSecret();
        if (!signingSecret) return { status: "invalid_ticket" as const };
        const next = payloadFor(refreshed.grant);
        return {
          status: "accepted" as const,
          ticket: issueEnterpriseWorkerDispatchTicket({
            payload: next, signingSecret,
          }),
          expiresAt: next.expiresAt,
        };
      });
    },

    publishMeetingTranslationEvents(input) {
      return withWorkerTicket(pool, input, async (unit, payload) => {
        const authorized = await unit.workerDispatches.authorize({
          payload, workerCellId: input.workerCellId, workerId: input.workerId,
          now: input.now,
        });
        if (authorized.status !== "authorized") return authorized;
        const meeting = await meetingForTicket(unit, payload);
        if (!meeting) return { status: "meeting_binding_mismatch" as const };
        return {
          status: "authorized" as const,
          deliveries: await unit.meetingTranslations.appendTargetEvents({
            meetingId: meeting.id,
            communicationSessionId: payload.communicationSessionId,
            grant: authorized.grant,
            sourceParticipantId: input.sourceParticipantId,
            sourceTrackSid: input.sourceTrackSid,
            events: input.events,
          }),
        };
      });
    },

    finalizeMeetingTranslationWorker(input) {
      return withWorkerTicket(pool, input, (unit, payload) =>
        unit.workerDispatches.finalize({
          payload, workerCellId: input.workerCellId, workerId: input.workerId,
          outcome: input.outcome, now: input.now,
        }));
    },
  };
}

function withWorkerTicket<T>(
  pool: EnterpriseTenantPostgresPool,
  input: { ticket: string; traceId: string; now?: Date },
  operation: (
    unit: Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0],
    payload: EnterpriseWorkerDispatchTicketPayload,
  ) => Promise<T>,
) {
  const signingSecret = workerSigningSecret();
  if (!signingSecret) return Promise.resolve({ status: "invalid_ticket" as const });
  const payload = verifyEnterpriseWorkerDispatchTicket({
    ticket: input.ticket, signingSecret, now: input.now,
  });
  if (!payload || payload.capability !== "translation_runtime") {
    return Promise.resolve({ status: "invalid_ticket" as const });
  }
  const context = createEnterpriseTenantContext({
    tenantId: payload.tenantId,
    actorUserId: "system:enterprise-meeting-translation",
    traceId: input.traceId,
  });
  return withEnterprisePostgresUnitOfWork(
    pool,
    context,
    (unit) => operation(unit, payload),
  );
}

async function meetingForTicket(
  unit: Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0],
  payload: EnterpriseWorkerDispatchTicketPayload,
) {
  const binding = await unit.communicationBindings.findBySession(
    payload.communicationSessionId,
  );
  if (!binding || binding.kind !== "meeting" ||
    binding.generation !== payload.generation ||
    binding.routeEpoch !== payload.routeEpoch) return null;
  return unit.meetings.find(binding.businessId, true);
}

function snapshotFor(
  meetingId: string,
  payload: EnterpriseWorkerDispatchTicketPayload,
  policy: {
    runtimeState: "full" | "captions_only" | "half_duplex" | "blocked";
    reasonCode: string;
  },
): EnterpriseMeetingTranslationWorkerSnapshot {
  if (policy.runtimeState === "blocked") {
    throw new Error("Blocked enterprise policy reached translation Worker");
  }
  return {
    meetingId,
    communicationSessionId: payload.communicationSessionId,
    roomName: roomNameFor(payload.communicationSessionId),
    generation: payload.generation,
    runtimeState: policy.runtimeState,
    reasonCode: policy.reasonCode,
  };
}

function payloadFor(grant: {
  id: string; tenantId: string; communicationSessionId: string;
  policySnapshotId: string; policyVersion: string; entitlementVersion: string;
  cellId: string; routeEpoch: number; generation: number;
  capability: "translation_runtime" | "voice_agent_runtime";
  issuedAt: string; expiresAt: string;
}): EnterpriseWorkerDispatchTicketPayload {
  return {
    v: 3, ticketId: grant.id, tenantId: grant.tenantId,
    communicationSessionId: grant.communicationSessionId,
    policySnapshotId: grant.policySnapshotId,
    policyVersion: grant.policyVersion,
    entitlementVersion: grant.entitlementVersion,
    cellId: grant.cellId, routeEpoch: grant.routeEpoch,
    generation: grant.generation, capability: grant.capability,
    issuedAt: grant.issuedAt, expiresAt: grant.expiresAt,
  };
}

function workerSigningSecret() {
  const value = process.env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? "";
  return Buffer.byteLength(value) >= 32 ? value : null;
}
function roomNameFor(sessionId: string) {
  return `ent_${sessionId.replaceAll("-", "")}`;
}
function translationAgentName() {
  const value = process.env.LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME?.trim() ||
    "enterprise-translation-runtime";
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(value)) {
    throw new Error("Invalid enterprise translation agent name");
  }
  return value;
}
function dispatchKey(meetingId: string, generation: number) {
  return `meeting-translation:${meetingId}:g${generation}`;
}
function leaseSeconds() {
  return integerEnv("ENTERPRISE_MEETING_WORKER_LEASE_SECONDS", 45, 15, 300);
}
function ticketTtlSeconds() {
  return integerEnv("ENTERPRISE_MEETING_WORKER_TICKET_TTL_SECONDS", 300, 30, 300);
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
function validDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error("Invalid enterprise meeting translation time");
  }
  return date;
}
function notReady(reasonCode: string) {
  return { status: "not_ready" as const, reasonCode };
}
