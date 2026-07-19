import { createHash, randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMeetingScreenOcrRuntime } from
  "../../modules/enterprise/enterprise-meeting-screen-ocr-runtime.js";
import {
  enterpriseMeetingScreenSharePublisherIdentity,
  enterpriseMeetingScreenShareRoomName,
} from "../../modules/enterprise/enterprise-meeting-screen-share.js";
import { issueEnterpriseMeetingScreenOcrTicket } from
  "../../modules/enterprise/enterprise-meeting-screen-ocr-ticket.js";
import { enterpriseMeetingParticipantIdentity } from
  "../../modules/enterprise/enterprise-meeting-translation.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import {
  withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresMeetingScreenOcrRuntime(
  pool: EnterpriseTenantPostgresPool,
  signingSecret: string,
): EnterpriseMeetingScreenOcrRuntime {
  return {
    currentMeetingScreenOcr(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const scope = await userScope(unit, input.meetingId, input.context.actorUserId);
        if (!scope) return { status: "forbidden" as const };
        if (!routeReady(scope)) return { status: "route_not_ready" as const };
        return { status: "ready" as const,
          view: await unit.meetingScreenOcr.current(input.meetingId) ??
            { run: null, subscription: null, layout: null } };
      });
    },

    enableMeetingScreenOcr(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const scope = await userScope(unit, input.meetingId, input.context.actorUserId);
        if (!scope) return { status: "forbidden" as const };
        if (!routeReady(scope)) return { status: "route_not_ready" as const };
        const share = await unit.meetingScreenShares.find(
          input.meetingId, input.shareId, true,
        );
        if (!share) return { status: "not_found" as const };
        if (scope.meeting.status !== "active" || share.status !== "active" ||
          !share.trackSid || !share.leaseExpiresAt ||
          Date.parse(share.leaseExpiresAt) <= input.now.getTime()) {
          return { status: "not_active" as const };
        }
        if (share.version !== input.expectedShareVersion) {
          return { status: "conflict" as const };
        }
        const entitlement = await screenOcrEntitlement(unit, input.now);
        if (entitlement !== "allowed") return { status: entitlement };
        const result = await unit.meetingScreenOcr.enable({
          runId: randomUUID(), subscriptionId: randomUUID(),
          meetingId: input.meetingId, shareId: share.id,
          shareGeneration: share.generation, participantId: scope.participant.id,
          targetLanguage: input.targetLanguage, displayMode: input.displayMode,
          idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
          now: input.now.toISOString(),
        });
        if (result.status !== "created" && result.status !== "replayed") {
          return result;
        }
        if (result.status === "created") {
          await audit(unit, input.context, "enable", result.view, input.now);
        }
        const run = result.view.run;
        const dispatch = run?.status === "pending"
          ? dispatchFor({ run, share, scope, signingSecret, now: input.now })
          : undefined;
        return { status: result.status, view: result.view,
          ...(dispatch ? { dispatch } : {}) };
      });
    },

    disableMeetingScreenOcr(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const scope = await userScope(unit, input.meetingId, input.context.actorUserId);
        if (!scope) return { status: "forbidden" as const };
        const result = await unit.meetingScreenOcr.disable({
          meetingId: input.meetingId, expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
          now: input.now.toISOString(),
        });
        if (result.status !== "updated" && result.status !== "replayed") {
          return result;
        }
        if (result.status === "updated") {
          await audit(unit, input.context, "disable", result.view, input.now);
        }
        return result;
      });
    },

    updateMeetingScreenOcrRunStatus(input) {
      return withEnterprisePostgresUnitOfWork(
        pool, input.context,
        (unit) => unit.meetingScreenOcr.updateRunStatus({
          meetingId: input.meetingId, runId: input.runId,
          expectedVersion: input.expectedVersion, status: input.status,
          reasonCode: input.reasonCode, now: input.now.toISOString(),
        }),
      );
    },

    acceptMeetingScreenOcrWorker(input) {
      return withWorkerUnit(pool, input.payload.tenantId, input.traceId,
        async (unit) => {
          if (!await workerAuthorized(unit, input.payload, input.now)) {
            return { status: "forbidden" as const };
          }
          const run = await unit.meetingScreenOcr.accept(
            input.payload.runId, input.now.toISOString(),
          );
          return run ? { status: "accepted" as const, run }
            : { status: "conflict" as const };
        });
    },

    claimMeetingScreenOcrFrame(input) {
      return withWorkerUnit(pool, input.payload.tenantId, input.traceId,
        async (unit) => {
          if (!await workerAuthorized(unit, input.payload, input.now, "active")) {
            return { status: "forbidden" as const };
          }
          const result = await unit.meetingScreenOcr.claimFrame({
            runId: input.payload.runId, frameId: input.frameId,
            perceptualHash: input.perceptualHash,
            sourceWidth: input.sourceWidth, sourceHeight: input.sourceHeight,
            capturedAt: input.capturedAt, now: input.now.toISOString(),
            maxHashDistance: hashDistanceThreshold(),
          });
          if (result.status !== "claimed") return result;
          const accounting = await unit.usageAccounting.record({
            category: "screen_ocr_frames", unit: "frames", amount: 1,
            sourceType: "meeting_screen_ocr", sourceRef: result.frame.id,
            idempotencyKey: `screen-ocr-frame:${result.frame.id}`,
            requestHash: digest({ runId: input.payload.runId,
              frameId: result.frame.id,
              perceptualHash: result.frame.perceptualHash }),
            occurredAt: result.frame.capturedAt, now: input.now,
            metadata: { meetingId: input.payload.meetingId,
              shareId: input.payload.shareId,
              shareGeneration: input.payload.shareGeneration,
              frameRevision: result.frame.frameRevision },
          });
          if (!["recorded", "replayed"].includes(accounting.status)) {
            throw new Error("Screen OCR usage accounting unavailable");
          }
          return { status: "claimed" as const, frameId: result.frame.id,
            frameRevision: result.frame.frameRevision };
        });
    },

    completeMeetingScreenOcrFrame(input) {
      return withWorkerUnit(pool, input.payload.tenantId, input.traceId,
        async (unit) => {
          if (!await workerAuthorized(unit, input.payload, input.now, "active")) {
            return { status: "forbidden" as const };
          }
          const result = await unit.meetingScreenOcr.completeFrame({
            runId: input.payload.runId, frameId: input.frameId,
            providerFingerprint: input.providerFingerprint,
            blocks: input.blocks, now: input.now.toISOString(),
          });
          if (result.status !== "completed") return result;
          const run = await unit.meetingScreenOcr.run(input.payload.runId);
          const layout = await unit.meetingScreenOcr.latestLayout(
            input.payload.runId,
          );
          if (!run || !layout) return { status: "conflict" as const };
          return {
            status: "completed" as const,
            view: { run, subscription: null, layout },
            targetParticipantIds: result.targets.map((target) => target.id),
            targetIdentities: result.targets.map((target) =>
              enterpriseMeetingParticipantIdentity({
                participantId: target.id, role: target.role,
              })),
          };
        });
    },

    failMeetingScreenOcrFrame(input) {
      return withWorkerUnit(pool, input.payload.tenantId, input.traceId,
        async (unit) => {
          if (!await workerAuthorized(unit, input.payload, input.now, "active")) {
            return { status: "forbidden" as const };
          }
          return unit.meetingScreenOcr.failFrame({
            runId: input.payload.runId,
            ...(input.frameId ? { frameId: input.frameId } : {}),
            reasonCode: input.reasonCode,
            ...(input.providerFingerprint
              ? { providerFingerprint: input.providerFingerprint } : {}),
            now: input.now.toISOString(),
          });
        });
    },
  };
}

type Unit = EnterprisePostgresUnitOfWork;
async function userScope(unit: Unit, meetingId: string, actorUserId: string) {
  const tenant = await unit.tenant.findTenant({ lock: false });
  const meeting = await unit.meetings.find(meetingId, false);
  const binding = await unit.communicationBindings.findByBusiness("meeting", meetingId);
  const participant = await unit.meetings.participantByUser(meetingId, actorUserId);
  return tenant && meeting && binding && participant?.joinedAt && !participant.leftAt
    ? { tenant, meeting, binding, participant } : null;
}

function routeReady(scope: NonNullable<Awaited<ReturnType<typeof userScope>>>) {
  return scope.tenant.status === "active" && Boolean(scope.tenant.cellId) &&
    scope.meeting.status === "active" && scope.binding.kind === "meeting" &&
    scope.binding.cellId === scope.tenant.cellId &&
    scope.binding.homeRegion === scope.tenant.homeRegion &&
    scope.binding.routeEpoch === scope.tenant.version &&
    ["ready", "active", "degraded", "captions_only", "half_duplex"]
      .includes(scope.binding.status);
}

async function screenOcrEntitlement(unit: Unit, now: Date) {
  const state = await unit.billingEntitlements.current(now);
  if (!state) return "entitlement_not_ready" as const;
  const feature = state.entitlement.entitlements["meeting.screen_ocr.enabled"];
  if (!feature) return "entitlement_not_ready" as const;
  return feature.enabled ? "allowed" as const : "policy_denied" as const;
}

function dispatchFor(input: { run: NonNullable<Awaited<ReturnType<
  EnterprisePostgresUnitOfWork["meetingScreenOcr"]["run"]>>>;
  share: NonNullable<Awaited<ReturnType<
    EnterprisePostgresUnitOfWork["meetingScreenShares"]["find"]>>>;
  scope: NonNullable<Awaited<ReturnType<typeof userScope>>>;
  signingSecret: string; now: Date }) {
  const expiresAt = new Date(input.now.getTime() + 300_000).toISOString();
  const payload = {
    v: 1 as const, runId: input.run.id, tenantId: input.run.tenantId,
    meetingId: input.run.meetingId,
    communicationSessionId: input.share.communicationSessionId,
    shareId: input.share.id, shareGeneration: input.share.generation,
    publisherIdentity: enterpriseMeetingScreenSharePublisherIdentity({
      shareId: input.share.id, generation: input.share.generation,
    }),
    trackSid: input.share.trackSid!, targetLanguage: input.run.targetLanguage,
    cellId: input.scope.tenant.cellId!, routeEpoch: input.scope.binding.routeEpoch,
    issuedAt: input.now.toISOString(), expiresAt,
  };
  return {
    run: input.run, ticket: Buffer.byteLength(input.signingSecret) >= 32
      ? issueEnterpriseMeetingScreenOcrTicket({
          payload, signingSecret: input.signingSecret,
        })
      : "", roomName: enterpriseMeetingScreenShareRoomName(
      input.share.communicationSessionId,
    ), agentName: screenOcrAgentName(),
    communicationSessionId: input.share.communicationSessionId,
    publisherIdentity: payload.publisherIdentity, trackSid: payload.trackSid,
    cellId: payload.cellId, routeEpoch: payload.routeEpoch, expiresAt,
  };
}

async function workerAuthorized(
  unit: Unit,
  payload: Parameters<NonNullable<EnterpriseMeetingScreenOcrRuntime[
    "acceptMeetingScreenOcrWorker"]>>[0]["payload"],
  now: Date,
  required: "pending_or_active" | "active" = "pending_or_active",
) {
  const tenant = await unit.tenant.findTenant({ lock: false });
  const meeting = await unit.meetings.find(payload.meetingId, false);
  const binding = await unit.communicationBindings.findByBusiness(
    "meeting", payload.meetingId,
  );
  const share = await unit.meetingScreenShares.find(
    payload.meetingId, payload.shareId, false,
  );
  const run = await unit.meetingScreenOcr.run(payload.runId);
  const hasSubscribers = await unit.meetingScreenOcr.hasEnabledSubscribers(
    payload.runId,
  );
  const allowedStatus = required === "active"
    ? run?.status === "active" : ["pending", "active"].includes(run?.status ?? "");
  return tenant?.status === "active" && meeting?.status === "active" && binding &&
    tenant.cellId === payload.cellId && tenant.version === payload.routeEpoch &&
    binding.communicationSessionId === payload.communicationSessionId &&
    binding.cellId === payload.cellId && binding.routeEpoch === payload.routeEpoch &&
    share?.status === "active" && share.generation === payload.shareGeneration &&
    share.communicationSessionId === payload.communicationSessionId &&
    share.trackSid === payload.trackSid && share.leaseExpiresAt &&
    Date.parse(share.leaseExpiresAt) > now.getTime() &&
    enterpriseMeetingScreenSharePublisherIdentity({
      shareId: share.id, generation: share.generation,
    }) ===
      payload.publisherIdentity && run?.meetingId === payload.meetingId &&
    run.shareId === payload.shareId &&
    run.shareGeneration === payload.shareGeneration &&
    run.targetLanguage === payload.targetLanguage && hasSubscribers && allowedStatus;
}

function withWorkerUnit<T>(pool: EnterpriseTenantPostgresPool, tenantId: string,
  traceId: string, operation: (unit: Unit) => Promise<T>) {
  return withEnterprisePostgresUnitOfWork(pool, createEnterpriseTenantContext({
    tenantId, actorUserId: "system:screen-ocr-worker", traceId,
  }), operation);
}

async function audit(unit: Unit, context: Parameters<
  typeof createEnterpriseAuditEvent>[0]["context"], command: string,
  view: { run: { id: string; shareId: string; shareGeneration: number } | null;
    subscription: { id: string; targetLanguage: string; displayMode: string;
      version: number } | null }, now: Date) {
  if (!view.run || !view.subscription) return;
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context, action: `meeting.screen_ocr.${command}`,
    resourceType: "meeting_screen_ocr", resourceId: view.subscription.id,
    result: "completed", details: { runId: view.run.id,
      shareId: view.run.shareId, shareGeneration: view.run.shareGeneration,
      targetLanguage: view.subscription.targetLanguage,
      displayMode: view.subscription.displayMode,
      version: view.subscription.version }, createdAt: now.toISOString(),
  }));
}

function screenOcrAgentName() {
  return process.env.LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME?.trim() ||
    process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() ||
    "translation-runtime";
}
function hashDistanceThreshold() {
  const value = Number(process.env.ENTERPRISE_SCREEN_OCR_HASH_DISTANCE ?? 4);
  return Number.isInteger(value) && value >= 0 && value <= 16 ? value : 4;
}
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
