import { randomUUID } from "node:crypto";
import type { EnterpriseSupportReadToolExecutionResponse } from
  "@translation/contracts";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import {
  normalizeEnterpriseSupportReadToolResult,
  supportReadToolName,
  unavailableEnterpriseSupportReadToolAdapter,
  type EnterpriseSupportReadToolAdapter,
  type EnterpriseSupportReadToolAdapterResult,
  type EnterpriseSupportReadToolName,
} from "../../modules/enterprise/enterprise-support-read-tool-adapter.js";
import { validateEnterpriseSupportToolArguments } from
  "../../modules/enterprise/enterprise-support-tool-registry.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { authorizeSupportAgentWorker, withSupportAgentWorker } from
  "./enterprise-postgres-support-agent-runtime.js";

type Runtime = Required<Pick<EnterpriseRepositoryRuntime,
  "executeSupportReadTool">>;
type WorkerUnit = Parameters<Parameters<typeof withSupportAgentWorker>[2]>[0];
type WorkerPayload = Parameters<Parameters<typeof withSupportAgentWorker>[2]>[1];
type ExecuteInput = Parameters<Runtime["executeSupportReadTool"]>[0];
type Claim = { status: "claimed"; claimId: string; executionId: string;
  toolName: EnterpriseSupportReadToolName; tenantId: string; customerId: string;
  idempotencyKey: string; arguments: Record<string, unknown>;
  providerFingerprint: string; providerSimulated: boolean };

const leaseMilliseconds = 15_000;
const adapterTimeoutMilliseconds = 5_000;

export function createEnterprisePostgresSupportReadToolRuntime(
  pool: EnterpriseTenantPostgresPool,
  adapter: EnterpriseSupportReadToolAdapter =
    unavailableEnterpriseSupportReadToolAdapter(),
): Runtime {
  return {
    async executeSupportReadTool(input) {
      const prepared = await withSupportAgentWorker(pool, input,
        (unit, payload) => prepare(unit, payload, input, adapter));
      if (prepared.status !== "claimed" || !("claimId" in prepared)) return prepared;
      const outcome = await executeAdapter(adapter, prepared);
      return withSupportAgentWorker(pool, input,
        (unit, payload) => finalize(unit, payload, input, prepared, outcome));
    },
  };
}

async function prepare(
  unit: WorkerUnit,
  payload: WorkerPayload,
  input: ExecuteInput,
  adapter: EnterpriseSupportReadToolAdapter,
): Promise<Claim | Exclude<Awaited<ReturnType<Runtime["executeSupportReadTool"]>>,
  { status: "completed" }>> {
  const authorized = await authorizeSupportAgentWorker(unit, payload, input);
  if (authorized.status !== "ready") return authorized;
  if (authorized.run.id !== input.runId || authorized.run.status !== "active") {
    return { status: "run_mismatch" };
  }
  const execution = await unit.supportToolExecutions.find(input.executionId, true);
  if (!execution) return { status: "not_found" };
  const toolName = supportReadToolName(execution.toolName);
  if (!toolName || execution.riskLevel !== "read" ||
    execution.authorizationScope !== "support:read" ||
    !execution.toolDefinitionId || !execution.argumentsHash) {
    return { status: "unsupported_tool" };
  }
  if (execution.sessionId !== authorized.run.supportSessionId) {
    return { status: "execution_mismatch" };
  }
  const session = await unit.support.findSession(execution.sessionId, true);
  if (!session || session.customerId !== execution.customerId) {
    return { status: "execution_mismatch" };
  }
  const definition = await unit.supportTools.findDefinition(
    execution.toolDefinitionId, true,
  );
  if (!definition || definition.toolName !== execution.toolName ||
    definition.revision !== execution.toolRevision ||
    definition.riskLevel !== "read" || definition.requiredScope !== "support:read") {
    return { status: "definition_not_active" };
  }
  let argumentsHash: string;
  try {
    argumentsHash = validateEnterpriseSupportToolArguments(
      definition.inputSchema, input.arguments,
    ).argumentsHash;
  } catch { return { status: "invalid_arguments" }; }
  if (argumentsHash !== execution.argumentsHash) {
    return { status: "invalid_arguments" };
  }
  const requestHash = enterpriseSupportAgentRequestHash({
    runId: authorized.run.id, sessionId: session.id,
    customerId: session.customerId, definitionId: definition.id,
    revision: definition.revision, argumentsHash,
  });
  if (requestHash !== execution.requestHash) {
    return { status: "execution_mismatch" };
  }
  if (execution.status === "completed") return completed(execution, true) ?? {
    status: "failed", reasonCode: "support_read_tool_result_invalid" };
  if (execution.status === "failed") return { status: "failed",
    ...(execution.failureCode ? { reasonCode: execution.failureCode } : {}) };
  if (session.status !== "ai_active") return { status: "execution_mismatch" };
  if (definition.status !== "active") return { status: "definition_not_active" };
  const now = input.now ?? new Date();
  if (execution.status === "running" && execution.executionLeaseExpiresAt &&
    Date.parse(execution.executionLeaseExpiresAt) > now.getTime()) {
    return { status: "in_progress" };
  }
  if (!["requested", "running"].includes(execution.status)) {
    return { status: "conflict" };
  }
  let readiness: ReturnType<EnterpriseSupportReadToolAdapter["readiness"]>;
  try { readiness = adapter.readiness(payload.tenantId); }
  catch { readiness = { status: "not_configured",
    reasonCode: "support_read_tool_adapter_unavailable" }; }
  if (readiness.status !== "ready") {
    await audit(unit, payload.tenantId, input.traceId, execution.id,
      execution.toolName, "not_configured", "denied", now,
      readiness.reasonCode);
    return readiness;
  }
  const claimId = randomUUID();
  const claimed = await unit.supportToolExecutions.claimRead({
    executionId: execution.id, expectedVersion: execution.version,
    leaseId: claimId, providerFingerprint: readiness.providerFingerprint,
    providerSimulated: readiness.simulated, now: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds).toISOString(),
  });
  if (claimed.status !== "claimed") return { status: "conflict" };
  await audit(unit, payload.tenantId, input.traceId, execution.id,
    execution.toolName, "started", "accepted", now, undefined,
    readiness.providerFingerprint, readiness.simulated);
  return { status: "claimed", claimId, executionId: execution.id, toolName,
    tenantId: payload.tenantId, customerId: session.customerId,
    idempotencyKey: execution.idempotencyKey, arguments: input.arguments,
    providerFingerprint: readiness.providerFingerprint,
    providerSimulated: readiness.simulated };
}

async function executeAdapter(
  adapter: EnterpriseSupportReadToolAdapter,
  claim: Claim,
): Promise<EnterpriseSupportReadToolAdapterResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      adapter.execute({ tenantId: claim.tenantId,
        customerId: claim.customerId, executionId: claim.executionId,
        idempotencyKey: claim.idempotencyKey, toolName: claim.toolName,
        arguments: claim.arguments, signal: controller.signal }),
      new Promise<EnterpriseSupportReadToolAdapterResult>((resolve) => {
        timeout = setTimeout(() => { controller.abort(); resolve({ status: "failed",
          reasonCode: "support_read_tool_timeout" }); }, adapterTimeoutMilliseconds);
      }),
    ]);
    if (result.status !== "completed") return { status: "failed",
      reasonCode: safeReason(result.reasonCode) };
    const normalized = normalizeEnterpriseSupportReadToolResult(
      claim.toolName, result.result,
    );
    const providerReference = safeReference(result.providerReference);
    return normalized && providerReference
      ? { status: "completed", result: normalized, providerReference }
      : { status: "failed", reasonCode: "support_read_tool_invalid_output" };
  } catch {
    return { status: "failed", reasonCode: controller.signal.aborted
      ? "support_read_tool_timeout" : "support_read_tool_unavailable" };
  } finally { if (timeout) clearTimeout(timeout); }
}

async function finalize(
  unit: WorkerUnit,
  payload: WorkerPayload,
  input: ExecuteInput,
  claim: Claim,
  outcome: EnterpriseSupportReadToolAdapterResult,
) {
  const authorized = await authorizeSupportAgentWorker(unit, payload, input);
  if (authorized.status !== "ready") return authorized;
  if (authorized.run.id !== input.runId || authorized.run.status !== "active") {
    return { status: "run_mismatch" as const };
  }
  const execution = await unit.supportToolExecutions.find(claim.executionId, true);
  if (!execution || execution.sessionId !== authorized.run.supportSessionId ||
    execution.status !== "running" || execution.executionLeaseId !== claim.claimId) {
    return { status: "conflict" as const };
  }
  const now = input.now ?? new Date();
  if (!execution.executionLeaseExpiresAt ||
    Date.parse(execution.executionLeaseExpiresAt) <= now.getTime()) {
    return { status: "lease_expired" as const };
  }
  const session = await unit.support.findSession(execution.sessionId, true);
  if (!session || session.status !== "ai_active" ||
    session.customerId !== execution.customerId) return {
    status: "execution_mismatch" as const };
  const definition = execution.toolDefinitionId
    ? await unit.supportTools.findDefinition(execution.toolDefinitionId, true)
    : null;
  const effectiveOutcome = !definition || definition.status !== "active" ||
    definition.id !== execution.toolDefinitionId ||
    definition.revision !== execution.toolRevision
    ? { status: "failed" as const,
        reasonCode: "support_read_definition_not_active" }
    : outcome;
  if (effectiveOutcome.status === "completed") {
    const resultHash = enterpriseSupportAgentRequestHash(effectiveOutcome.result);
    const completedRecord = await unit.supportToolExecutions.completeRead({
      executionId: execution.id, expectedVersion: execution.version,
      leaseId: claim.claimId, result: effectiveOutcome.result, resultHash,
      providerReference: effectiveOutcome.providerReference,
      completedAt: now.toISOString(),
    });
    if (completedRecord.status !== "completed") return { status: "conflict" as const };
    await audit(unit, payload.tenantId, input.traceId, execution.id,
      execution.toolName, "completed", "completed", now, undefined,
      execution.providerFingerprint, execution.providerSimulated, resultHash);
    return completed(completedRecord.execution, false) ?? {
      status: "failed" as const,
      reasonCode: "support_read_tool_result_invalid",
    };
  }
  const reasonCode = safeReason(effectiveOutcome.reasonCode);
  const failed = await unit.supportToolExecutions.failRead({
    executionId: execution.id, expectedVersion: execution.version,
    leaseId: claim.claimId, reasonCode, failedAt: now.toISOString(),
  });
  if (failed.status !== "failed") return { status: "conflict" as const };
  await audit(unit, payload.tenantId, input.traceId, execution.id,
    execution.toolName, "failed", "failed", now, reasonCode,
    execution.providerFingerprint, execution.providerSimulated);
  return { status: "failed" as const, reasonCode };
}

function completed(
  execution: Awaited<ReturnType<WorkerUnit["supportToolExecutions"]["find"]>> & {},
  replayed: boolean,
): EnterpriseSupportReadToolExecutionResponse | null {
  const toolName = supportReadToolName(execution.toolName);
  const result = toolName && execution.resultDocument
    ? normalizeEnterpriseSupportReadToolResult(toolName, execution.resultDocument)
    : null;
  if (!toolName || !result || !execution.resultHash ||
    enterpriseSupportAgentRequestHash(result) !== execution.resultHash ||
    !execution.providerFingerprint || execution.providerSimulated === undefined ||
    !execution.externalResultRef) {
    return null;
  }
  return { status: "completed", executionId: execution.id,
    toolName, result,
    resultHash: execution.resultHash,
    providerFingerprint: execution.providerFingerprint,
    simulated: execution.providerSimulated,
    providerReference: execution.externalResultRef,
    ...(replayed ? { replayed: true } : {}) };
}

async function audit(unit: WorkerUnit, tenantId: string, traceId: string,
  executionId: string, toolName: string, decision: string,
  result: "accepted" | "completed" | "failed" | "denied", now: Date,
  reasonCode?: string, providerFingerprint?: string, simulated?: boolean,
  resultHash?: string) {
  const context = createEnterpriseTenantContext({ tenantId,
    actorUserId: "system:enterprise-support-agent", traceId });
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
    action: "support.tool.read.execute", resourceType: "tool_execution",
    resourceId: executionId, result, details: { toolName, decision,
      ...(reasonCode ? { reasonCode } : {}),
      ...(providerFingerprint ? { providerFingerprint } : {}),
      ...(simulated === undefined ? {} : { simulated }),
      ...(resultHash ? { resultHash } : {}) }, createdAt: now.toISOString() }));
}

function safeReason(value: string) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value : "support_read_tool_invalid_output";
}
function safeReference(value: string) {
  return value.trim() && Buffer.byteLength(value.trim()) <= 400
    ? value.trim() : null;
}
