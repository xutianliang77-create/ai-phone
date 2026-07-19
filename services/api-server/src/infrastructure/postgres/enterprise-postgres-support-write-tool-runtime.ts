import { createHash, randomUUID } from "node:crypto";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import {
  createEnterpriseSupportWriteCommandService,
  type EnterpriseSupportWriteCommandService,
} from "../../modules/enterprise/enterprise-support-write-command.js";
import {
  enterpriseSupportConfirmationDecision,
  enterpriseSupportWriteConfirmation,
  normalizeEnterpriseSupportWriteArguments,
  supportWriteHash,
  supportWriteToolName,
  unavailableEnterpriseSupportWriteAdapter,
} from "../../modules/enterprise/enterprise-support-write-tool.js";
import { validateEnterpriseSupportToolArguments } from
  "../../modules/enterprise/enterprise-support-tool-registry.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { authorizeSupportAgentWorker, withSupportAgentWorker } from
  "./enterprise-postgres-support-agent-runtime.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { supportWriteDecisionReplay } from
  "./enterprise-postgres-support-write-tool-replay.js";

type Runtime = Required<Pick<EnterpriseRepositoryRuntime,
  "prepareSupportWriteConfirmation" | "confirmSupportWriteTool" |
  "finalizeSupportWriteToolOutbox">>;
type Unit = Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0];
type PrepareInput = Parameters<Runtime["prepareSupportWriteConfirmation"]>[0];
const confirmationTtlMilliseconds = 120_000;

export function createEnterprisePostgresSupportWriteToolRuntime(
  pool: EnterpriseTenantPostgresPool,
  command: EnterpriseSupportWriteCommandService =
    createEnterpriseSupportWriteCommandService({
      adapter: unavailableEnterpriseSupportWriteAdapter(),
    }),
): Runtime {
  return {
    prepareSupportWriteConfirmation(input) {
      return withSupportAgentWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeSupportAgentWorker(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        if (authorized.run.id !== input.runId || authorized.run.status !== "active" ||
          authorized.run.locale !== input.locale) return { status: "run_mismatch" as const };
        const checked = await checkExecution(unit, authorized.run, input, input.arguments);
        if (checked.status !== "ready") return checked;
        const now = input.now ?? new Date();
        if (!futureCallback(checked.tool, now)) return { status: "invalid_arguments" as const };
        const confirmation = enterpriseSupportWriteConfirmation({
          tool: checked.tool, locale: authorized.run.locale,
        });
        if (checked.execution.status === "awaiting_confirmation" &&
          checked.execution.confirmationChallengeId &&
          checked.execution.confirmationExpiresAt &&
          Date.parse(checked.execution.confirmationExpiresAt) > now.getTime()) {
          if (checked.execution.confirmationPromptHash !== confirmation.promptHash) {
            return { status: "conflict" as const };
          }
          return response(checked.execution, confirmation, true);
        }
        if (checked.execution.status !== "awaiting_confirmation") {
          return { status: "conflict" as const };
        }
        const readiness = command.readiness(payload.tenantId);
        if (readiness.status !== "ready") return readiness;
        const challengeId = randomUUID();
        const expiresAt = new Date(now.getTime() + confirmationTtlMilliseconds);
        const prepared = await unit.supportToolExecutions.prepareWriteConfirmation({
          executionId: checked.execution.id,
          expectedVersion: checked.execution.version, challengeId,
          promptHash: confirmation.promptHash, runId: authorized.run.id,
          afterSequence: authorized.run.lastTurnSequence,
          requestedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
        });
        if (prepared.status !== "prepared") return { status: "conflict" as const };
        await audit(unit, payload.tenantId, input.traceId, prepared.execution.id,
          "confirmation_requested", "accepted", now,
          { challengeId, promptHash: confirmation.promptHash,
            providerFingerprint: readiness.providerFingerprint,
            simulated: readiness.simulated });
        return response(prepared.execution, confirmation, false);
      });
    },

    confirmSupportWriteTool(input) {
      return withSupportAgentWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeSupportAgentWorker(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        if (authorized.run.id !== input.runId || authorized.run.status !== "active") {
          return { status: "run_mismatch" as const };
        }
        const existing = await unit.supportToolExecutions.find(input.executionId, true);
        if (!existing) return { status: "not_found" as const };
        if (existing.sessionId !== authorized.run.supportSessionId) {
          return { status: "execution_mismatch" as const };
        }
        const priorDecision = supportWriteDecisionReplay(existing, input);
        if (priorDecision) return priorDecision;
        const checked = await checkExecution(unit, authorized.run, input, input.arguments);
        if (checked.status !== "ready") return checked;
        const now = input.now ?? new Date();
        if (checked.execution.status !== "awaiting_confirmation" ||
          checked.execution.confirmationChallengeId !== input.confirmationId ||
          checked.execution.confirmationRunId !== authorized.run.id) {
          return { status: "conflict" as const };
        }
        if (!checked.execution.confirmationExpiresAt ||
          Date.parse(checked.execution.confirmationExpiresAt) < now.getTime()) {
          return { status: "confirmation_expired" as const };
        }
        const turn = await unit.supportAgents.findTurn(input.turnId, true);
        if (!turn || turn.runId !== authorized.run.id ||
          turn.supportSessionId !== checked.execution.sessionId ||
          turn.sequence <= (checked.execution.confirmationAfterSequence ?? -1) ||
          !checked.execution.confirmationRequestedAt ||
          Date.parse(turn.createdAt) < Date.parse(checked.execution.confirmationRequestedAt) ||
          !["generated", "degraded", "tts_authorized", "delivered"].includes(turn.status) ||
          turn.customerTextHash !== rawHash(input.customerText)) {
          return { status: "execution_mismatch" as const };
        }
        const decision = enterpriseSupportConfirmationDecision(input.customerText);
        if (!decision) return { status: "confirmation_unrecognized" as const };
        const responseHash = rawHash(input.customerText);
        if (decision === "rejected") {
          const rejected = await unit.supportToolExecutions.rejectWrite({
            executionId: checked.execution.id,
            expectedVersion: checked.execution.version,
            challengeId: input.confirmationId, turnId: turn.id,
            responseHash, decidedAt: now.toISOString(),
          });
          if (rejected.status !== "rejected") return { status: "conflict" as const };
          await audit(unit, payload.tenantId, input.traceId, checked.execution.id,
            "confirmation_rejected", "denied", now,
            { challengeId: input.confirmationId, turnId: turn.id });
          return { status: "rejected" as const,
            executionId: checked.execution.id };
        }
        if (!futureCallback(checked.tool, now)) return { status: "invalid_arguments" as const };
        let outboxPayload;
        try { outboxPayload = command.prepare({ tenantId: payload.tenantId,
          executionId: checked.execution.id, customerId: checked.execution.customerId,
          toolName: checked.tool.toolName,
          idempotencyKey: checked.execution.idempotencyKey,
          arguments: checked.tool.value,
          argumentsHash: checked.execution.argumentsHash! }); }
        catch (error) { return { status: "not_configured" as const,
          reasonCode: error instanceof Error ? error.message :
            "support_write_tool_not_configured" }; }
        const eventId = randomUUID();
        const confirmed = await unit.supportToolExecutions.confirmWrite({
          executionId: checked.execution.id,
          expectedVersion: checked.execution.version,
          challengeId: input.confirmationId, turnId: turn.id,
          responseHash, decidedAt: now.toISOString(), outboxEventId: eventId,
          providerFingerprint: outboxPayload.providerFingerprint,
          providerSimulated: outboxPayload.providerSimulated,
        });
        if (confirmed.status !== "confirmed") return { status: "conflict" as const };
        const inserted = await unit.events.insertOutbox({ id: eventId,
          tenantId: payload.tenantId, aggregateType: "support_tool_execution",
          aggregateId: checked.execution.id, eventType: "support.tool.write.requested",
          idempotencyKey: `support-tool-write:${checked.execution.id}`,
          payload: outboxPayload, traceId: input.traceId, attempts: 0,
          availableAt: now.toISOString(), createdAt: now.toISOString() });
        if (inserted.status !== "created" || inserted.event.id !== eventId) {
          throw new Error("Support write outbox idempotency conflict");
        }
        await audit(unit, payload.tenantId, input.traceId, checked.execution.id,
          "confirmed_and_queued", "accepted", now,
          { challengeId: input.confirmationId, turnId: turn.id, eventId,
            providerFingerprint: outboxPayload.providerFingerprint,
            simulated: outboxPayload.providerSimulated });
        return { status: "processing" as const,
          executionId: checked.execution.id, outboxEventId: eventId };
      });
    },

    finalizeSupportWriteToolOutbox(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context,
        async (unit) => finalize(unit, input));
    },
  };
}

async function checkExecution(unit: Unit, run: { id: string;
  supportSessionId: string }, input: { executionId: string; runId: string },
  args: Record<string, unknown>) {
  const execution = await unit.supportToolExecutions.find(input.executionId, true);
  if (!execution) return { status: "not_found" as const };
  const toolName = supportWriteToolName(execution.toolName);
  if (!toolName || execution.riskLevel !== "reversible_write" ||
    execution.authorizationScope !== "support:manage" ||
    !execution.toolDefinitionId || !execution.argumentsHash) {
    return { status: "unsupported_tool" as const };
  }
  if (execution.sessionId !== run.supportSessionId) {
    return { status: "execution_mismatch" as const };
  }
  const session = await unit.support.findSession(execution.sessionId, true);
  if (!session || session.status !== "ai_active" ||
    session.customerId !== execution.customerId) {
    return { status: "execution_mismatch" as const };
  }
  const definition = await unit.supportTools.findDefinition(
    execution.toolDefinitionId, true,
  );
  if (!definition || definition.status !== "active" ||
    definition.toolName !== execution.toolName ||
    definition.revision !== execution.toolRevision ||
    definition.riskLevel !== "reversible_write" ||
    definition.requiredScope !== "support:manage" ||
    definition.confirmationMode !== "customer_confirmation") {
    return { status: "definition_not_active" as const };
  }
  let validated;
  try { validated = validateEnterpriseSupportToolArguments(
    definition.inputSchema, args); }
  catch { return { status: "invalid_arguments" as const }; }
  const tool = normalizeEnterpriseSupportWriteArguments(toolName, args);
  if (!tool || validated.argumentsHash !== execution.argumentsHash ||
    supportWriteHash(tool.value) !== execution.argumentsHash) {
    return { status: "invalid_arguments" as const };
  }
  const requestHash = enterpriseSupportAgentRequestHash({ runId: input.runId,
    sessionId: session.id, customerId: session.customerId,
    definitionId: definition.id, revision: definition.revision,
    argumentsHash: validated.argumentsHash });
  return requestHash === execution.requestHash
    ? { status: "ready" as const, execution, tool }
    : { status: "execution_mismatch" as const };
}

function response(execution: { id: string; confirmationChallengeId?: string;
  confirmationExpiresAt?: string }, confirmation: ReturnType<
    typeof enterpriseSupportWriteConfirmation>, replayed: boolean) {
  if (!execution.confirmationChallengeId || !execution.confirmationExpiresAt) {
    throw new Error("Support write confirmation persistence failed");
  }
  return { status: "confirmation_required" as const, executionId: execution.id,
    confirmationId: execution.confirmationChallengeId,
    prompt: confirmation.prompt, promptHash: confirmation.promptHash,
    summary: confirmation.summary, expiresAt: execution.confirmationExpiresAt,
    ...(replayed ? { replayed: true } : {}) };
}

async function finalize(unit: Unit,
  input: Parameters<Runtime["finalizeSupportWriteToolOutbox"]>[0]) {
  const execution = await unit.supportToolExecutions.findByWriteOutbox(
    input.eventId, true,
  );
  if (!execution || execution.status !== "confirmed" ||
    input.attempt <= execution.executionAttempt) {
    throw new Error("Support write outbox execution fence conflict");
  }
  const receipt = input.result.status === "completed" ? input.result.receipt : undefined;
  const validReceipt = receipt?.kind === "support_write_tool" &&
    receipt.executionId === execution.id && receipt.toolName === execution.toolName &&
    receipt.providerFingerprint === execution.providerFingerprint &&
    receipt.simulated === execution.providerSimulated ? receipt : null;
  const outcome = input.result.status === "retry" || !validReceipt
    ? { status: "retry" as const, reasonCode: safeCode(input.result.status === "retry"
        ? input.result.reason : "support_write_tool_receipt_invalid") }
    : validReceipt.outcome === "completed"
      ? { status: "completed" as const, document: validReceipt.result,
          resultHash: validReceipt.resultHash,
          providerReference: validReceipt.providerReference }
      : { status: "failed" as const, reasonCode: safeCode(validReceipt.reasonCode),
          providerReference: validReceipt.providerReference };
  const updated = await unit.supportToolExecutions.finalizeWrite({
    executionId: execution.id, expectedVersion: execution.version,
    eventId: input.eventId, result: outcome, completedAt: input.now.toISOString(),
  });
  if (updated.status === "conflict") throw new Error("Support write finalize conflict");
  const retrying = outcome.status === "retry";
  const event = await unit.events.finalizeOutbox({ eventId: input.eventId,
    attempt: input.attempt,
    availableAt: retrying ? new Date(input.now.getTime() +
      Math.min(1_000 * 2 ** Math.max(0, input.attempt - 1), 300_000)).toISOString()
      : input.now.toISOString(),
    ...(retrying ? { lastErrorCode: outcome.reasonCode }
      : { publishedAt: input.now.toISOString() }) });
  if (event.status !== "updated") throw new Error("Support write outbox finalize conflict");
  await audit(unit, input.context.tenantId, input.context.traceId, execution.id,
    retrying ? "retry_scheduled" : outcome.status,
    retrying ? "failed" : outcome.status === "completed" ? "completed" : "failed",
    input.now, { attempt: input.attempt,
      ...(outcome.status === "retry" || outcome.status === "failed"
        ? { reasonCode: outcome.reasonCode } : { resultHash: outcome.resultHash }),
      providerFingerprint: execution.providerFingerprint,
      simulated: execution.providerSimulated });
  return { status: retrying ? "retried" as const :
    outcome.status === "completed" ? "completed" as const : "failed" as const };
}

async function audit(unit: Unit, tenantId: string, traceId: string,
  executionId: string, decision: string,
  result: "accepted" | "completed" | "failed" | "denied", now: Date,
  details: Record<string, unknown>) {
  const context = createEnterpriseTenantContext({ tenantId,
    actorUserId: "system:enterprise-support-agent", traceId });
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
    action: "support.tool.write.execute", resourceType: "tool_execution",
    resourceId: executionId, result, details: { decision, ...details },
    createdAt: now.toISOString() }));
}

function futureCallback(tool: ReturnType<typeof normalizeEnterpriseSupportWriteArguments> & {},
  now: Date) { return tool.toolName !== "callback.schedule" ||
    Date.parse(tool.value.scheduledAt) > now.getTime(); }
function rawHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function safeCode(value: string) { return /^[a-z][a-z0-9_]{0,63}$/.test(value)
  ? value : "support_write_tool_failed"; }
