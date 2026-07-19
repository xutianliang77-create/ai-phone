import { createHash } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseSupportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-runtime.js";
import type { EnterpriseSupportWriteCommandService } from
  "../../modules/enterprise/enterprise-support-write-command.js";
import {
  normalizeEnterpriseSupportWriteArguments,
  supportWriteHash,
} from "../../modules/enterprise/enterprise-support-write-tool.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { workbenchAccess } from
  "./enterprise-postgres-support-workbench-runtime.js";
import { withEnterprisePostgresUnitOfWork, type EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<Pick<EnterpriseSupportRepositoryRuntime,
  "createSupportFollowup" | "finalizeSupportFollowupOutbox">>;

export function createEnterprisePostgresSupportFollowupRuntime(
  pool: EnterpriseTenantPostgresPool,
  command: EnterpriseSupportWriteCommandService,
): Runtime {
  return {
    createSupportFollowup(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const access = await workbenchAccess(
          unit, input.sessionId, input.now, input.context,
        );
        if (access.status !== "ready") return access;
        if (access.session.version !== input.expectedSessionVersion ||
          access.claim.version !== input.expectedClaimVersion) {
          return { status: "conflict" as const };
        }
        const prior = await unit.supportFollowups.findByKey(
          access.session.id, input.idempotencyKey, true,
        );
        const requestHash = supportWriteHash({ sessionId: access.session.id,
          customerId: access.session.customerId, action: input.action });
        if (prior) return priorRequest(prior, requestHash);
        const toolName = input.action.kind === "ticket"
          ? "ticket.create" as const : "callback.schedule" as const;
        const args = input.action.kind === "ticket"
          ? { subject: input.action.subject, description: input.action.description }
          : { scheduledAt: input.action.scheduledAt, reason: input.action.reason };
        const normalized = normalizeEnterpriseSupportWriteArguments(toolName, args);
        const now = new Date(input.now);
        if (!normalized || !Number.isFinite(now.getTime()) ||
          (normalized.toolName === "callback.schedule" &&
            Date.parse(normalized.value.scheduledAt) <= now.getTime())) {
          return { status: "invalid_arguments" as const };
        }
        const readiness = command.readiness(input.context.tenantId);
        if (readiness.status !== "ready") return readiness;
        const commandId = stableUuid([input.context.tenantId, access.session.id,
          input.idempotencyKey, input.action.kind].join(":"));
        const businessId = stableUuid(`${commandId}:${input.action.kind}`);
        const eventId = stableUuid(`${commandId}:outbox`);
        const argumentsHash = supportWriteHash(normalized.value);
        let payload;
        try {
          payload = command.prepare({ tenantId: input.context.tenantId,
            executionId: commandId, customerId: access.session.customerId,
            toolName, idempotencyKey: `support-followup:${commandId}`,
            arguments: normalized.value, argumentsHash });
        } catch (error) {
          return { status: "not_configured" as const,
            reasonCode: error instanceof Error ? error.message :
              "support_write_tool_not_configured" };
        }
        if (input.action.kind === "ticket") {
          const created = await unit.support.createCase({ id: businessId,
            customerId: access.session.customerId, sessionId: access.session.id,
            subject: input.action.subject, status: "pending",
            summary: input.action.description,
            createdAt: input.now });
          if (created.status !== "created") {
            const replay = await unit.supportFollowups.findByKey(
              access.session.id, input.idempotencyKey, true,
            );
            return replay ? priorRequest(replay, requestHash) :
              { status: "conflict" as const };
          }
        } else {
          const created = await unit.supportFollowups.createCallback({ id: businessId,
            sessionId: access.session.id, customerId: access.session.customerId,
            scheduledAt: input.action.scheduledAt, reason: input.action.reason,
            createdBy: input.context.actorUserId, createdAt: input.now });
          if (!created) {
            const replay = await unit.supportFollowups.findByKey(
              access.session.id, input.idempotencyKey, true,
            );
            return replay ? priorRequest(replay, requestHash) :
              { status: "conflict" as const };
          }
        }
        const followup = await unit.supportFollowups.createCommand({ id: commandId,
          sessionId: access.session.id, customerId: access.session.customerId,
          agentClaimId: access.claim.id, kind: input.action.kind,
          ...(input.action.kind === "ticket"
            ? { caseId: businessId } : { callbackId: businessId }),
          idempotencyKey: input.idempotencyKey, requestHash, outboxEventId: eventId,
          providerFingerprint: payload.providerFingerprint,
          providerSimulated: payload.providerSimulated,
          createdBy: input.context.actorUserId, createdAt: input.now });
        if (!followup) throw new Error("Support followup command conflict");
        const inserted = await unit.events.insertOutbox({ id: eventId,
          tenantId: input.context.tenantId,
          aggregateType: "support_followup_command", aggregateId: commandId,
          eventType: "support.followup.requested",
          idempotencyKey: `support-followup:${commandId}`, payload,
          traceId: input.context.traceId, attempts: 0,
          availableAt: input.now, createdAt: input.now });
        if (inserted.status !== "created" || inserted.event.id !== eventId) {
          throw new Error("Support followup outbox conflict");
        }
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "support.followup.create",
          resourceType: "support_followup", resourceId: followup.id,
          result: "accepted", details: { kind: followup.kind,
            claimId: followup.agentClaimId, providerFingerprint:
              followup.providerFingerprint, simulated: followup.providerSimulated },
          createdAt: input.now,
        }));
        return { status: "processing" as const, followup };
      });
    },

    finalizeSupportFollowupOutbox(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const followup = await unit.supportFollowups.findByOutbox(input.eventId, true);
        if (!followup || followup.status !== "processing" ||
          input.attempt <= followup.attempts) {
          throw new Error("Support followup outbox fence conflict");
        }
        const outcome = followupOutcome(followup, input.result);
        const updated = await unit.supportFollowups.finalize({ command: followup,
          attempt: input.attempt, outcome, updatedAt: input.now.toISOString() });
        if (!updated) throw new Error("Support followup finalize conflict");
        const retrying = outcome.status === "retry";
        const event = await unit.events.finalizeOutbox({ eventId: input.eventId,
          attempt: input.attempt,
          availableAt: retrying ? new Date(input.now.getTime() +
            Math.min(1_000 * 2 ** Math.max(0, input.attempt - 1), 300_000))
            .toISOString() : input.now.toISOString(),
          ...(retrying ? { lastErrorCode: outcome.reasonCode }
            : { publishedAt: input.now.toISOString() }) });
        if (event.status !== "updated") throw new Error("Support followup event conflict");
        await auditFinalize(unit, input, updated, outcome);
        return { status: retrying ? "retried" as const :
          outcome.status === "completed" ? "completed" as const : "failed" as const };
      });
    },
  };
}

function followupOutcome(followup: { id: string; kind: "ticket" | "callback";
  providerFingerprint: string; providerSimulated: boolean },
  result: Parameters<Runtime["finalizeSupportFollowupOutbox"]>[0]["result"]) {
  if (result.status === "retry") return { status: "retry" as const,
    reasonCode: safeCode(result.reason) };
  const receipt = result.receipt;
  const toolName = followup.kind === "ticket" ? "ticket.create" : "callback.schedule";
  if (receipt.kind !== "support_write_tool" || receipt.executionId !== followup.id ||
    receipt.toolName !== toolName ||
    receipt.providerFingerprint !== followup.providerFingerprint ||
    receipt.simulated !== followup.providerSimulated) {
    return { status: "retry" as const,
      reasonCode: "support_followup_receipt_invalid" };
  }
  return receipt.outcome === "completed"
    ? { status: "completed" as const, receipt }
    : { status: "failed" as const, reasonCode: safeCode(receipt.reasonCode),
        providerReference: receipt.providerReference };
}

async function auditFinalize(unit: EnterprisePostgresUnitOfWork,
  input: Parameters<Runtime["finalizeSupportFollowupOutbox"]>[0],
  followup: { id: string; kind: string; attempts: number },
  outcome: ReturnType<typeof followupOutcome>) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
    context: input.context, action: "support.followup.dispatch",
    resourceType: "support_followup", resourceId: followup.id,
    result: outcome.status === "completed" ? "completed" : "failed",
    details: { kind: followup.kind, attempt: followup.attempts,
      decision: outcome.status === "retry" ? "retry_scheduled" : outcome.status,
      ...(outcome.status === "retry" || outcome.status === "failed"
        ? { reasonCode: outcome.reasonCode } : {}) },
    createdAt: input.now.toISOString(),
  }));
}
function priorRequest(
  followup: import("../../modules/enterprise/enterprise-support.js").EnterpriseSupportFollowupRecord,
  requestHash: string) {
  return followup.requestHash === requestHash
    ? { status: "replayed" as const, followup }
    : { status: "idempotency_conflict" as const };
}
function stableUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const item = hex.join("");
  return `${item.slice(0, 8)}-${item.slice(8, 12)}-${item.slice(12, 16)}-${
    item.slice(16, 20)}-${item.slice(20)}`;
}
function safeCode(value: string) { return /^[a-z][a-z0-9_]{0,63}$/.test(value)
  ? value : "support_followup_failed"; }
