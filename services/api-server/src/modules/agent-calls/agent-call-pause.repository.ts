import {
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { tryAcquireAgentCallMutation } from "./agent-call-mutation-lock.js";
import { findAgentCallDraft } from "./agent-calls.repository.js";

export function pauseAgentCallDraft(userId: string, draftId: string) {
  return updatePauseState(userId, draftId, "paused");
}

export function resumePausedAgentCallDraft(userId: string, draftId: string) {
  return updatePauseState(userId, draftId, "running");
}

function updatePauseState(
  userId: string,
  draftId: string,
  desiredState: "paused" | "running",
) {
  const releaseMutation = tryAcquireAgentCallMutation(draftId);
  if (!releaseMutation) return { status: "mutation_conflict" as const };
  try {
    return runStoreTransaction(() => {
      const draft = findAgentCallDraft(userId, draftId);
      if (!draft) return { status: "not_found" as const };
      if (draft.status !== "in_progress") {
        return { status: "invalid_state" as const, draft: structuredClone(draft) };
      }
      const currentState = draft.agentControlState ?? "running";
      if (currentState === desiredState) {
        return { status: "replayed" as const, draft: structuredClone(draft) };
      }
      const now = new Date().toISOString();
      draft.agentControlState = desiredState;
      if (desiredState === "paused") draft.agentPausedAt = now;
      else draft.agentResumedAt = now;
      draft.updatedAt = now;
      persistStoreSnapshot();
      // Repository results are immutable observations. Returning the mutable
      // store object lets a later resume rewrite an earlier pause result.
      return { status: "updated" as const, draft: structuredClone(draft) };
    });
  } finally {
    releaseMutation();
  }
}
