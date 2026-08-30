import type {
  EnterpriseSupportAgentTurnOutput,
  EnterpriseSupportToolDefinitionDto,
} from "@translation/contracts";
import {
  enterpriseSupportReadToolSpokenText,
  normalizeEnterpriseSupportReadToolResult,
  supportReadToolName,
} from "../../modules/enterprise/enterprise-support-read-tool-adapter.js";
import { validateEnterpriseSupportAgentOutput } from
  "../../modules/enterprise/enterprise-support-agent.js";
import { enterpriseSupportAgentRequestHash } from
  "../../modules/enterprise/enterprise-support-agent.js";
import { supportToolDefinitionDto, validateEnterpriseSupportToolArguments } from
  "../../modules/enterprise/enterprise-support-tool-registry.js";
import {
  enterpriseSupportWriteConfirmation,
  normalizeEnterpriseSupportWriteArguments,
  supportWriteToolName,
} from "../../modules/enterprise/enterprise-support-write-tool.js";
import type { EnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export async function listSupportAgentToolDefinitions(
  unit: EnterprisePostgresUnitOfWork,
): Promise<EnterpriseSupportToolDefinitionDto[]> {
  const candidates = (await unit.supportTools.listDefinitions()).filter((item) =>
    item.status === "active" && (item.riskLevel === "high_risk" ||
      item.riskLevel === "read" && Boolean(supportReadToolName(item.toolName)) ||
      item.riskLevel === "reversible_write" &&
        Boolean(supportWriteToolName(item.toolName))))
    .slice(0, 32).map(supportToolDefinitionDto);
  const result: EnterpriseSupportToolDefinitionDto[] = [];
  let bytes = 2;
  for (const definition of candidates) {
    const next = Buffer.byteLength(JSON.stringify(definition));
    if (bytes + next + 1 > 65_536) break;
    result.push(definition); bytes += next + 1;
  }
  return result;
}

export async function validateSupportAgentCompletionOutput(
  unit: EnterprisePostgresUnitOfWork,
  run: { id: string; supportSessionId: string; locale: string },
  input: {
    output: EnterpriseSupportAgentTurnOutput;
    toolResultEvidence?: { executionId: string; resultHash: string };
    toolConfirmationEvidence?: {
      executionId: string;
      confirmationId: string;
      arguments: Record<string, unknown>;
    };
  },
  allowedCitations: ReadonlySet<string>,
  now: Date,
) {
  if (input.toolResultEvidence && input.toolConfirmationEvidence) return null;
  if (!input.toolResultEvidence && !input.toolConfirmationEvidence) {
    const output = validateEnterpriseSupportAgentOutput(
      input.output, allowedCitations,
    );
    return output?.toolRequest === null ? output : null;
  }
  const executionId = (input.toolResultEvidence ??
    input.toolConfirmationEvidence)!.executionId;
  const execution = await unit.supportToolExecutions.find(executionId, true);
  if (!execution || execution.sessionId !== run.supportSessionId) return null;
  if (input.toolResultEvidence) {
    const toolName = supportReadToolName(execution.toolName);
    const result = toolName && execution.resultDocument
      ? normalizeEnterpriseSupportReadToolResult(toolName, execution.resultDocument)
      : null;
    const session = await unit.support.findSession(execution.sessionId, true);
    const definition = execution.toolDefinitionId
      ? await unit.supportTools.findDefinition(execution.toolDefinitionId, true)
      : null;
    const expectedHash = session && definition && execution.argumentsHash
      ? enterpriseSupportAgentRequestHash({ runId: run.id,
          sessionId: session.id, customerId: session.customerId,
          definitionId: definition.id, revision: definition.revision,
          argumentsHash: execution.argumentsHash }) : null;
    if (!toolName || !result || !session || !definition ||
      session.customerId !== execution.customerId ||
      definition.status !== "active" || definition.toolName !== toolName ||
      definition.revision !== execution.toolRevision ||
      definition.riskLevel !== "read" ||
      definition.requiredScope !== "support:read" ||
      execution.riskLevel !== "read" ||
      execution.status !== "completed" ||
      execution.requestHash !== expectedHash ||
      execution.resultHash !== input.toolResultEvidence.resultHash ||
      execution.providerSimulated === undefined) return null;
    return deterministicOutput(input.output,
      enterpriseSupportReadToolSpokenText({ locale: run.locale, result,
        simulated: execution.providerSimulated }));
  }
  const evidence = input.toolConfirmationEvidence!;
  const toolName = supportWriteToolName(execution.toolName);
  if (!toolName || execution.riskLevel !== "reversible_write" ||
    execution.status !== "awaiting_confirmation" ||
    execution.confirmationRunId !== run.id ||
    execution.confirmationChallengeId !== evidence.confirmationId ||
    !execution.confirmationExpiresAt ||
    Date.parse(execution.confirmationExpiresAt) <= now.getTime() ||
    !execution.toolDefinitionId || !execution.argumentsHash) return null;
  const definition = await unit.supportTools.findDefinition(
    execution.toolDefinitionId, true,
  );
  if (!definition || definition.status !== "active" ||
    definition.toolName !== toolName ||
    definition.revision !== execution.toolRevision ||
    definition.riskLevel !== "reversible_write" ||
    definition.requiredScope !== "support:manage" ||
    definition.confirmationMode !== "customer_confirmation") return null;
  let argumentsHash: string;
  try { argumentsHash = validateEnterpriseSupportToolArguments(
    definition.inputSchema, evidence.arguments,
  ).argumentsHash; } catch { return null; }
  const normalized = normalizeEnterpriseSupportWriteArguments(
    toolName, evidence.arguments,
  );
  if (!normalized || argumentsHash !== execution.argumentsHash) return null;
  const session = await unit.support.findSession(execution.sessionId, true);
  const expectedHash = session ? enterpriseSupportAgentRequestHash({
    runId: run.id, sessionId: session.id, customerId: session.customerId,
    definitionId: definition.id, revision: definition.revision,
    argumentsHash }) : null;
  if (!session || session.customerId !== execution.customerId ||
    expectedHash !== execution.requestHash) return null;
  let confirmation: ReturnType<typeof enterpriseSupportWriteConfirmation>;
  try { confirmation = enterpriseSupportWriteConfirmation({
    tool: normalized, locale: run.locale,
  }); } catch { return null; }
  if (confirmation.promptHash !== execution.confirmationPromptHash) return null;
  return deterministicOutput(input.output, confirmation.prompt);
}

function deterministicOutput(
  value: EnterpriseSupportAgentTurnOutput,
  spokenText: string,
): EnterpriseSupportAgentTurnOutput | null {
  if (Object.keys(value).sort().join(",") !== ["conversationState", "intent",
    "knowledgeCitations", "riskSignals", "spokenText", "toolRequest"]
    .sort().join(",") || value.spokenText !== spokenText ||
    value.intent !== "answer" || value.conversationState !== "answering" ||
    value.toolRequest !== null || value.riskSignals.length !== 0 ||
    value.knowledgeCitations.length !== 0) return null;
  return { spokenText, intent: "answer", toolRequest: null, riskSignals: [],
    knowledgeCitations: [], conversationState: "answering" };
}
