import type {
  EnterpriseSupportAgentPendingConfirmation,
  EnterpriseSupportReadToolExecutionResponse,
  EnterpriseSupportAgentTurnOutput,
  EnterpriseSupportAgentTurnResponse,
  EnterpriseSupportToolAuthorizationResponse,
  EnterpriseSupportWriteConfirmationResponse,
} from "@translation/contracts";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import {
  enterpriseSupportReadToolSpokenText,
} from "./enterprise-support-read-tool-adapter.js";
import {
  enterpriseSupportAgentFallback,
  type EnterpriseSupportAgentProvider,
} from "./enterprise-support-agent.js";
import { supportWriteToolName } from "./enterprise-support-write-tool.js";

type Prepared = Extract<Awaited<ReturnType<NonNullable<
  EnterpriseRepositoryRuntime["prepareSupportAgentTurn"]>>>, { status: "ready" }>;
type Worker = { ticket: string; workerCellId: string; workerId: string;
  traceId: string };

export interface OrchestratedSupportAgentOutput {
  output: EnterpriseSupportAgentTurnOutput;
  status: "generated" | "degraded" | "handoff";
  providerFingerprint?: string;
  failureCode?: string;
  toolResultEvidence?: { executionId: string; resultHash: string };
  toolConfirmationEvidence?: { executionId: string; confirmationId: string;
    arguments: Record<string, unknown> };
  toolAction?: EnterpriseSupportAgentTurnResponse["toolAction"];
}

export async function recoverSupportAgentToolAction(input: {
  runtime: EnterpriseRepositoryRuntime;
  provider: EnterpriseSupportAgentProvider;
  prepared: Prepared;
  customerText: string;
  worker: Worker;
}) {
  const prior = input.prepared.turn.output;
  if (!prior || prior.intent !== "answer" ||
    prior.knowledgeCitations.length !== 0 || prior.riskSignals.length !== 0) {
    return undefined;
  }
  const generated = await input.provider.generate({
    sessionId: input.prepared.run.supportSessionId,
    locale: input.prepared.run.locale, countryCode: input.prepared.run.countryCode,
    productCode: input.prepared.run.productCode, customerText: input.customerText,
    recentTurns: input.prepared.context,
    conversationState: input.prepared.run.conversationState,
    evidence: input.prepared.resolution.status === "grounded"
      ? input.prepared.resolution.evidence : [],
    toolDefinitions: input.prepared.toolDefinitions,
  });
  const request = generated.status === "ready" ? generated.output.toolRequest : null;
  const toolName = supportWriteToolName(request?.toolName);
  if (!request || !toolName || !input.runtime.authorizeSupportToolRequest ||
    !input.runtime.prepareSupportWriteConfirmation) return undefined;
  const authorized = await input.runtime.authorizeSupportToolRequest({
    ...input.worker, runId: input.prepared.run.id, toolName,
    idempotencyKey: `support.tool:${input.prepared.turn.id}`,
    arguments: request.arguments,
  });
  if (!authorization(authorized, "confirmation_required") ||
    !authorized.executionId) return undefined;
  const confirmation = await input.runtime.prepareSupportWriteConfirmation({
    ...input.worker, runId: input.prepared.run.id,
    executionId: authorized.executionId, locale: input.prepared.run.locale,
    arguments: request.arguments,
  });
  if (!writeConfirmation(confirmation) ||
    confirmation.executionId !== authorized.executionId ||
    confirmation.prompt !== prior.spokenText) return undefined;
  return confirmationOutput(input.prepared, toolName, request.arguments,
    confirmation).toolAction;
}

export async function orchestratePendingSupportWriteDecision(input: {
  runtime: EnterpriseRepositoryRuntime;
  prepared: Prepared;
  pending: EnterpriseSupportAgentPendingConfirmation;
  customerText: string;
  worker: Worker;
}): Promise<
  | { completed: true; run: Prepared["run"]; turn: Prepared["turn"] }
  | { completed: false; generated: OrchestratedSupportAgentOutput }
> {
  const decision = input.runtime.completeSupportWriteDecisionTurn
    ? await input.runtime.completeSupportWriteDecisionTurn({ ...input.worker,
        runId: input.prepared.run.id, turnId: input.prepared.turn.id,
        executionId: input.pending.executionId,
        confirmationId: input.pending.confirmationId,
        customerText: input.customerText, arguments: input.pending.arguments,
        context: input.prepared.context })
    : { status: "not_configured" as const,
        reasonCode: "support_write_decision_runtime_not_configured" };
  if (completedDecision(decision, input.prepared)) {
    return { completed: true, run: decision.run, turn: decision.turn };
  }
  if (decision.status === "confirmation_unrecognized") {
    const confirmation = input.runtime.prepareSupportWriteConfirmation
      ? await input.runtime.prepareSupportWriteConfirmation({ ...input.worker,
          runId: input.prepared.run.id,
          executionId: input.pending.executionId,
          locale: input.prepared.run.locale,
          arguments: input.pending.arguments })
      : { status: "not_configured" as const,
          reasonCode: "support_write_tool_runtime_not_configured" };
    if (writeConfirmation(confirmation) &&
      confirmation.executionId === input.pending.executionId) return { completed: false,
      generated: confirmationOutput(input.prepared, input.pending.toolName,
        input.pending.arguments, confirmation) };
  }
  return { completed: false, generated: fallback(input.prepared,
    reason(decision.status, reasonCode(decision)), "degraded") };
}

export async function orchestrateSupportAgentOutput(input: {
  runtime: EnterpriseRepositoryRuntime;
  provider: EnterpriseSupportAgentProvider;
  prepared: Prepared;
  customerText: string;
  worker: Worker;
}): Promise<OrchestratedSupportAgentOutput> {
  if (input.prepared.resolution.status === "no_evidence" &&
    input.prepared.toolDefinitions.length === 0) {
    return fallback(input.prepared, "support_agent_no_evidence", "handoff");
  }
  const generated = await input.provider.generate({
    sessionId: input.prepared.run.supportSessionId,
    locale: input.prepared.run.locale,
    countryCode: input.prepared.run.countryCode,
    productCode: input.prepared.run.productCode,
    customerText: input.customerText,
    recentTurns: input.prepared.context,
    conversationState: input.prepared.run.conversationState,
    evidence: input.prepared.resolution.status === "grounded"
      ? input.prepared.resolution.evidence : [],
    toolDefinitions: input.prepared.toolDefinitions,
  });
  if (generated.status !== "ready") {
    return fallback(input.prepared, generated.reasonCode, "degraded");
  }
  const request = generated.output.toolRequest;
  if (!request) return { output: generated.output,
    status: generated.output.intent === "handoff" ? "handoff" : "generated",
    providerFingerprint: generated.providerFingerprint };
  const authorized = input.runtime.authorizeSupportToolRequest
    ? await input.runtime.authorizeSupportToolRequest({ ...input.worker,
        runId: input.prepared.run.id, toolName: request.toolName,
        idempotencyKey: `support.tool:${input.prepared.turn.id}`,
        arguments: request.arguments })
    : { status: "storage_required" as const };
  if (authorization(authorized, "handoff_required")) {
    return fallback(input.prepared, "support_tool_high_risk_handoff", "handoff",
      generated.providerFingerprint);
  }
  if (authorization(authorized, "authorized") && authorized.executionId) {
    return executeRead(input, authorized.executionId, request.arguments,
      generated.providerFingerprint);
  }
  if (authorization(authorized, "confirmation_required") &&
    authorized.executionId) {
    return prepareWrite(input, authorized.executionId, request.toolName,
      request.arguments, generated.providerFingerprint);
  }
  return fallback(input.prepared, reason(authorized.status), "degraded",
    generated.providerFingerprint);
}

async function executeRead(input: Parameters<typeof orchestrateSupportAgentOutput>[0],
  executionId: string, args: Record<string, unknown>, fingerprint: string) {
  const result = input.runtime.executeSupportReadTool
    ? await input.runtime.executeSupportReadTool({ ...input.worker,
        runId: input.prepared.run.id, executionId, arguments: args })
    : { status: "not_configured" as const,
        reasonCode: "support_read_tool_runtime_not_configured" };
  if (!readCompletion(result)) {
    return fallback(input.prepared, reason(result.status,
      reasonCode(result)), "degraded",
    fingerprint);
  }
  const spokenText = enterpriseSupportReadToolSpokenText({
    locale: input.prepared.run.locale, result: result.result,
    simulated: result.simulated,
  });
  return { output: { spokenText, intent: "answer" as const, toolRequest: null,
      riskSignals: [], knowledgeCitations: [],
      conversationState: "answering" as const },
    status: "generated" as const, providerFingerprint: fingerprint,
    toolResultEvidence: { executionId, resultHash: result.resultHash } };
}

async function prepareWrite(input: Parameters<typeof orchestrateSupportAgentOutput>[0],
  executionId: string, toolName: string, args: Record<string, unknown>,
  fingerprint: string) {
  const result = input.runtime.prepareSupportWriteConfirmation
    ? await input.runtime.prepareSupportWriteConfirmation({ ...input.worker,
        runId: input.prepared.run.id, executionId,
        locale: input.prepared.run.locale, arguments: args })
    : { status: "not_configured" as const,
        reasonCode: "support_write_tool_runtime_not_configured" };
  if (!writeConfirmation(result) || result.executionId !== executionId) {
    return fallback(input.prepared, reason(result.status,
      reasonCode(result)), "degraded",
    fingerprint);
  }
  const supportedToolName = supportWriteToolName(toolName);
  if (!supportedToolName) {
    return fallback(input.prepared, "support_write_tool_unsupported",
      "degraded", fingerprint);
  }
  return confirmationOutput(input.prepared, supportedToolName, args, result,
    fingerprint);
}

function confirmationOutput(prepared: Prepared,
  toolName: EnterpriseSupportAgentPendingConfirmation["toolName"],
  args: Record<string, unknown>,
  result: EnterpriseSupportWriteConfirmationResponse,
  fingerprint?: string): OrchestratedSupportAgentOutput {
  const executionId = result.executionId;
  const confirmation: EnterpriseSupportAgentPendingConfirmation = {
    executionId, confirmationId: result.confirmationId,
    toolName,
    arguments: { ...args }, expiresAt: result.expiresAt,
  };
  return { output: { spokenText: result.prompt, intent: "answer" as const,
      toolRequest: null, riskSignals: [], knowledgeCitations: [],
      conversationState: "answering" as const },
    status: "generated" as const,
    ...(fingerprint ? { providerFingerprint: fingerprint } : {}),
    toolConfirmationEvidence: { executionId,
      confirmationId: result.confirmationId, arguments: { ...args } },
    toolAction: { status: "confirmation_required" as const,
      confirmation, promptHash: result.promptHash } };
}

function fallback(prepared: Prepared, reasonCode: string,
  status: "degraded" | "handoff", providerFingerprint?: string) {
  return { output: enterpriseSupportAgentFallback(prepared.run.locale,
      safeReason(reasonCode)), status,
    failureCode: safeReason(reasonCode),
    ...(providerFingerprint ? { providerFingerprint } : {}) };
}
function reason(status: string, detail?: string) {
  return safeReason(detail ?? `support_tool_${status}`);
}
function safeReason(value: string) {
  return /^[a-z][a-z0-9_]{1,79}$/.test(value)
    ? value : "support_tool_orchestration_failed";
}

function authorization(value: unknown,
  status: EnterpriseSupportToolAuthorizationResponse["status"]):
  value is EnterpriseSupportToolAuthorizationResponse {
  return object(value)?.status === status;
}
function readCompletion(value: unknown):
  value is EnterpriseSupportReadToolExecutionResponse {
  const item = object(value);
  return item?.status === "completed" && typeof item.executionId === "string" &&
    typeof item.resultHash === "string" && typeof item.simulated === "boolean" &&
    object(item.result) !== null;
}
function writeConfirmation(value: unknown):
  value is EnterpriseSupportWriteConfirmationResponse {
  const item = object(value);
  return item?.status === "confirmation_required" &&
    typeof item.executionId === "string" && typeof item.confirmationId === "string" &&
    typeof item.prompt === "string" && typeof item.promptHash === "string" &&
    typeof item.expiresAt === "string";
}
function reasonCode(value: unknown) {
  const result = object(value)?.reasonCode;
  return typeof result === "string" ? result : undefined;
}
function completedDecision(value: unknown, prepared: Prepared): value is {
  status: "updated"; run: Prepared["run"]; turn: Prepared["turn"] } {
  const item = object(value);
  const run = object(item?.run);
  const turn = object(item?.turn);
  return item?.status === "updated" && run?.id === prepared.run.id &&
    run.supportSessionId === prepared.run.supportSessionId &&
    run.generation === prepared.run.generation &&
    turn?.id === prepared.turn.id && turn.runId === prepared.run.id &&
    object(turn.output) !== null;
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
