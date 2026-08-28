import type { VoiceAgentStructuredResultDto } from "@translation/contracts";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import { cleanText } from "./agent-call-repository-helpers.js";
import { recordAgentCallRuntimeResult as recordLegacyResult } from
  "./agent-call-runtime-result.repository.js";
import { mutateAgentCallTask } from "./agent-calls-runtime.repository.js";

export async function recordAgentCallRuntimeResult(
  draftId: string,
  value: VoiceAgentStructuredResultDto,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return recordLegacyResult(draftId, value);
  const current = await runtime.postgres.agentTasks.find(draftId);
  if (!current) return null;
  const result = await mutateAgentCallTask(
    current,
    "runtime-result",
    value,
    (next) => applyRuntimeResult(next, value),
    "agent.task.runtime_result",
    "updated",
  );
  return hasTask(result) ? result.task : current;
}

function applyRuntimeResult(
  draft: AgentCallRecord,
  value: VoiceAgentStructuredResultDto,
) {
  draft.resultSummary = cleanText(value.summary, 800) || draft.resultSummary;
  draft.nextStep = cleanText(value.nextStep, 300) ||
    cleanText(value.unresolvedItems.join("；"), 300) || draft.nextStep;
  if (draft.status === "in_progress") {
    draft.status = "reconciliation_required";
    draft.workerLeaseExpiresAt = undefined;
    draft.nextStep = draft.nextStep ||
      "AI 已结束发言，等待电话网络终态后结算。";
  }
  draft.updatedAt = new Date().toISOString();
  return draft;
}

function hasTask(value: unknown): value is { task: AgentCallRecord } {
  return Boolean(value && typeof value === "object" && "task" in value);
}
