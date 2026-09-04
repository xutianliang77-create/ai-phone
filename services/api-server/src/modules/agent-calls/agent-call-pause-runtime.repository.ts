import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  pauseAgentCallDraft as pauseLegacyDraft,
  resumePausedAgentCallDraft as resumeLegacyDraft,
} from "./agent-call-pause.repository.js";
import { mutateAgentCallTask } from "./agent-calls-runtime.repository.js";

export function pauseAgentCallDraft(userId: string, draftId: string) {
  return updateRuntimePauseState(userId, draftId, "paused");
}

export function resumePausedAgentCallDraft(userId: string, draftId: string) {
  return updateRuntimePauseState(userId, draftId, "running");
}

async function updateRuntimePauseState(
  userId: string,
  draftId: string,
  desiredState: "paused" | "running",
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return desiredState === "paused"
      ? pauseLegacyDraft(userId, draftId)
      : resumeLegacyDraft(userId, draftId);
  }
  const current = await runtime.postgres.agentTasks.findOwned(userId, draftId);
  if (!current) return { status: "not_found" as const };
  if (current.status !== "in_progress") {
    return { status: "invalid_state" as const, draft: current };
  }
  const currentState = current.agentControlState ?? "running";
  if (currentState === desiredState) {
    return { status: "replayed" as const, draft: current };
  }
  const operation = desiredState === "paused" ? "pause" : "resume";
  const result = await mutateAgentCallTask(current, operation, {
    previousState: currentState,
    previousUpdatedAt: current.updatedAt,
  }, (next) => applyPauseState(next, desiredState),
  `agent.task.${desiredState === "paused" ? "paused" : "resumed"}`, "updated");
  return hasTask(result)
    ? { status: "updated" as const, draft: result.task }
    : { status: "mutation_conflict" as const };
}

function applyPauseState(
  draft: AgentCallRecord,
  desiredState: "paused" | "running",
) {
  if (draft.status !== "in_progress") return null;
  const now = new Date().toISOString();
  draft.agentControlState = desiredState;
  if (desiredState === "paused") draft.agentPausedAt = now;
  else draft.agentResumedAt = now;
  draft.updatedAt = now;
  return draft;
}

function hasTask(value: unknown): value is { task: AgentCallRecord } {
  return Boolean(value && typeof value === "object" && "task" in value);
}
