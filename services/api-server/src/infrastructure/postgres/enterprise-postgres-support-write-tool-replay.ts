import { createHash } from "node:crypto";
import {
  normalizeEnterpriseSupportWriteArguments,
  normalizeEnterpriseSupportWriteResult,
  supportWriteHash,
  supportWriteToolName,
} from "../../modules/enterprise/enterprise-support-write-tool.js";
import type { EnterpriseToolExecutionRecord } from
  "../../modules/enterprise/enterprise-support.js";

export function supportWriteDecisionReplay(
  execution: EnterpriseToolExecutionRecord,
  input: { runId: string; confirmationId: string; turnId: string;
    customerText: string; arguments: Record<string, unknown> },
) {
  if (execution.confirmationChallengeId !== input.confirmationId ||
    execution.confirmationTurnId !== input.turnId ||
    execution.confirmationRunId !== input.runId ||
    execution.confirmationResponseHash !== rawHash(input.customerText)) return null;
  const toolName = supportWriteToolName(execution.toolName);
  const args = toolName
    ? normalizeEnterpriseSupportWriteArguments(toolName, input.arguments) : null;
  if (!args || supportWriteHash(args.value) !== execution.argumentsHash) return null;
  if (execution.status === "confirmed" && execution.writeOutboxEventId) {
    return { status: "processing" as const, executionId: execution.id,
      outboxEventId: execution.writeOutboxEventId, replayed: true as const };
  }
  if (execution.status === "completed" && toolName &&
    execution.resultDocument && execution.resultHash &&
    execution.providerFingerprint && execution.providerSimulated !== undefined &&
    execution.externalResultRef) {
    const result = normalizeEnterpriseSupportWriteResult(
      toolName, execution.resultDocument,
    );
    if (result && supportWriteHash(result) === execution.resultHash) {
      return { status: "completed" as const, executionId: execution.id,
        toolName, result, resultHash: execution.resultHash,
        providerFingerprint: execution.providerFingerprint,
        simulated: execution.providerSimulated,
        providerReference: execution.externalResultRef, replayed: true as const };
    }
  }
  if (execution.status === "failed" && execution.failureCode &&
    execution.providerFingerprint && execution.providerSimulated !== undefined &&
    execution.externalResultRef) {
    return { status: "failed" as const, executionId: execution.id,
      reasonCode: execution.failureCode,
      providerFingerprint: execution.providerFingerprint,
      simulated: execution.providerSimulated,
      providerReference: execution.externalResultRef, replayed: true as const };
  }
  return execution.status === "rejected" ? { status: "rejected" as const,
    executionId: execution.id, replayed: true as const } : null;
}

function rawHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
