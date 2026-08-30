import { createHash, randomUUID } from "node:crypto";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { compactEnterpriseSupportAgentContext,
  enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import type { EnterpriseSupportWriteCommandService } from
  "../../modules/enterprise/enterprise-support-write-command.js";
import { enterpriseSupportConfirmationDecision,
  enterpriseSupportWriteConfirmation, enterpriseSupportWriteDecisionOutput,
  normalizeEnterpriseSupportWriteArguments, supportWriteHash, supportWriteToolName } from
  "../../modules/enterprise/enterprise-support-write-tool.js";
import { validateEnterpriseSupportToolArguments } from
  "../../modules/enterprise/enterprise-support-tool-registry.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { authorizeSupportAgentWorker, withSupportAgentWorker } from
  "./enterprise-postgres-support-agent-runtime.js";

type Runtime = Required<Pick<EnterpriseRepositoryRuntime,
  "completeSupportWriteDecisionTurn">>;
type Input = Parameters<Runtime["completeSupportWriteDecisionTurn"]>[0];
type Unit = Parameters<Parameters<typeof withSupportAgentWorker>[2]>[0];

export function completeSupportWriteDecisionTurn(
  pool: EnterpriseTenantPostgresPool,
  command: EnterpriseSupportWriteCommandService,
  input: Input,
) {
  return withSupportAgentWorker(pool, input, async (unit, payload) => {
    const authorized = await authorizeSupportAgentWorker(unit, payload, input);
    if (authorized.status !== "ready") return authorized;
    if (authorized.run.id !== input.runId || authorized.run.status !== "active") {
      return { status: "run_mismatch" as const };
    }
    const checked = await check(unit, authorized.run, input);
    if (checked.status !== "ready") return checked;
    const decision = enterpriseSupportConfirmationDecision(input.customerText);
    if (!decision) return { status: "confirmation_unrecognized" as const };
    const now = input.now ?? new Date();
    if (!checked.execution.confirmationExpiresAt ||
      Date.parse(checked.execution.confirmationExpiresAt) < now.getTime()) {
      return { status: "confirmation_expired" as const };
    }
    let outbox: ReturnType<EnterpriseSupportWriteCommandService["prepare"]> |
      undefined;
    if (decision === "confirmed") {
      let readiness: ReturnType<EnterpriseSupportWriteCommandService["readiness"]>;
      try { readiness = command.readiness(payload.tenantId); }
      catch { readiness = { status: "not_configured",
        reasonCode: "support_write_tool_adapter_unavailable" }; }
      if (readiness.status !== "ready") return readiness;
      try { outbox = command.prepare({ tenantId: payload.tenantId,
        executionId: checked.execution.id,
        customerId: checked.execution.customerId,
        toolName: checked.tool.toolName,
        idempotencyKey: checked.execution.idempotencyKey,
        arguments: checked.tool.value,
        argumentsHash: checked.execution.argumentsHash! }); }
      catch (error) { return { status: "not_configured" as const,
        reasonCode: error instanceof Error ? error.message :
          "support_write_tool_not_configured" }; }
    }
    const output = enterpriseSupportWriteDecisionOutput(
      authorized.run.locale, decision,
    );
    const context = compactEnterpriseSupportAgentContext([
      ...input.context, { role: "customer", text: input.customerText },
      { role: "assistant", text: output.spokenText },
    ]);
    const completed = await unit.supportAgents.completeTurn({
      runId: authorized.run.id, turnId: checked.turn.id, output,
      status: "generated", contextDocument: [...context],
      contextHash: enterpriseSupportAgentRequestHash(context),
      completedAt: now.toISOString(),
    });
    if (completed.status !== "updated") return completed;
    if (decision === "rejected") {
      const rejected = await unit.supportToolExecutions.rejectWrite({
        executionId: checked.execution.id,
        expectedVersion: checked.execution.version,
        challengeId: input.confirmationId, turnId: checked.turn.id,
        responseHash: rawHash(input.customerText), decidedAt: now.toISOString(),
      });
      if (rejected.status !== "rejected") {
        throw new Error("Support write rejection lost execution fence");
      }
      await audit(unit, payload.tenantId, input.traceId, checked.execution.id,
        "confirmation_rejected", "denied", now, checked.turn.id);
      return { status: "updated" as const, run: completed.run,
        turn: completed.turn, decision: "rejected" as const };
    }
    const eventId = randomUUID();
    const confirmed = await unit.supportToolExecutions.confirmWrite({
      executionId: checked.execution.id,
      expectedVersion: checked.execution.version,
      challengeId: input.confirmationId, turnId: checked.turn.id,
      responseHash: rawHash(input.customerText), decidedAt: now.toISOString(),
      outboxEventId: eventId, providerFingerprint: outbox!.providerFingerprint,
      providerSimulated: outbox!.providerSimulated,
    });
    if (confirmed.status !== "confirmed") {
      throw new Error("Support write confirmation lost execution fence");
    }
    const inserted = await unit.events.insertOutbox({ id: eventId,
      tenantId: payload.tenantId, aggregateType: "support_tool_execution",
      aggregateId: checked.execution.id,
      eventType: "support.tool.write.requested",
      idempotencyKey: `support-tool-write:${checked.execution.id}`,
      payload: outbox!, traceId: input.traceId, attempts: 0,
      availableAt: now.toISOString(), createdAt: now.toISOString() });
    if (inserted.status !== "created" || inserted.event.id !== eventId) {
      throw new Error("Support write outbox idempotency conflict");
    }
    await audit(unit, payload.tenantId, input.traceId, checked.execution.id,
      "confirmed_and_queued", "accepted", now, checked.turn.id, eventId,
      outbox!.providerFingerprint, outbox!.providerSimulated);
    return { status: "updated" as const, run: completed.run,
      turn: completed.turn, decision: "processing" as const };
  });
}

async function check(unit: Unit, run: { id: string; supportSessionId: string;
  lastTurnSequence: number; locale: string }, input: Input) {
  const execution = await unit.supportToolExecutions.find(input.executionId, true);
  if (!execution) return { status: "not_found" as const };
  const toolName = supportWriteToolName(execution.toolName);
  if (!toolName || execution.riskLevel !== "reversible_write" ||
    execution.authorizationScope !== "support:manage" ||
    execution.status !== "awaiting_confirmation" ||
    execution.confirmationChallengeId !== input.confirmationId ||
    execution.confirmationRunId !== run.id || !execution.toolDefinitionId ||
    !execution.argumentsHash) return { status: "execution_mismatch" as const };
  if (execution.sessionId !== run.supportSessionId) {
    return { status: "execution_mismatch" as const };
  }
  const session = await unit.support.findSession(execution.sessionId, true);
  const definition = await unit.supportTools.findDefinition(
    execution.toolDefinitionId, true,
  );
  if (!session || session.status !== "ai_active" ||
    session.customerId !== execution.customerId || !definition ||
    definition.status !== "active" || definition.toolName !== execution.toolName ||
    definition.revision !== execution.toolRevision ||
    definition.riskLevel !== "reversible_write" ||
    definition.requiredScope !== "support:manage" ||
    definition.confirmationMode !== "customer_confirmation") {
    return { status: "definition_not_active" as const };
  }
  let argumentsHash: string;
  try { argumentsHash = validateEnterpriseSupportToolArguments(
    definition.inputSchema, input.arguments,
  ).argumentsHash; } catch { return { status: "invalid_arguments" as const }; }
  const tool = normalizeEnterpriseSupportWriteArguments(toolName, input.arguments);
  if (!tool || argumentsHash !== execution.argumentsHash ||
    supportWriteHash(tool.value) !== execution.argumentsHash) {
    return { status: "invalid_arguments" as const };
  }
  let confirmation: ReturnType<typeof enterpriseSupportWriteConfirmation>;
  try { confirmation = enterpriseSupportWriteConfirmation({
    tool, locale: run.locale,
  }); } catch { return { status: "invalid_arguments" as const }; }
  if (confirmation.promptHash !== execution.confirmationPromptHash) {
    return { status: "execution_mismatch" as const };
  }
  const expected = enterpriseSupportAgentRequestHash({ runId: run.id,
    sessionId: session.id, customerId: session.customerId,
    definitionId: definition.id, revision: definition.revision, argumentsHash });
  if (expected !== execution.requestHash) {
    return { status: "execution_mismatch" as const };
  }
  const turn = await unit.supportAgents.findTurn(input.turnId, true);
  if (!turn || turn.status !== "prepared" || turn.runId !== run.id ||
    turn.supportSessionId !== session.id ||
    turn.sequence <= (execution.confirmationAfterSequence ?? -1) ||
    !execution.confirmationRequestedAt ||
    Date.parse(turn.createdAt) < Date.parse(execution.confirmationRequestedAt) ||
    turn.customerTextHash !== rawHash(input.customerText)) {
    return { status: "execution_mismatch" as const };
  }
  return { status: "ready" as const, execution, tool, turn };
}

async function audit(unit: Unit, tenantId: string, traceId: string,
  executionId: string, decision: string, result: "accepted" | "denied",
  now: Date, turnId: string, eventId?: string,
  providerFingerprint?: string, simulated?: boolean) {
  const context = createEnterpriseTenantContext({ tenantId,
    actorUserId: "system:enterprise-support-agent", traceId });
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
    action: "support.tool.write.execute", resourceType: "tool_execution",
    resourceId: executionId, result, details: { decision, turnId,
      ...(eventId ? { eventId } : {}),
      ...(providerFingerprint ? { providerFingerprint } : {}),
      ...(simulated === undefined ? {} : { simulated }) },
    createdAt: now.toISOString() }));
}

function rawHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
