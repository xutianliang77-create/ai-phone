import type { VoiceAgentStructuredResultDto } from "@translation/contracts";
import {
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { clearAgentCallLease } from "./agent-call-lease.repository.js";
import { cleanText } from "./agent-call-repository-helpers.js";
import { findAgentCallDraftById } from "./agent-calls.repository.js";

export function recordAgentCallRuntimeResult(
  draftId: string,
  result: VoiceAgentStructuredResultDto,
) {
  return runStoreTransaction(() => {
    const draft = findAgentCallDraftById(draftId);
    if (!draft) return null;
    draft.resultSummary = cleanText(result.summary, 800) || draft.resultSummary;
    draft.nextStep = cleanText(result.nextStep, 300) ||
      cleanText(result.unresolvedItems.join("；"), 300) || draft.nextStep;
    if (draft.status === "in_progress") {
      draft.status = "reconciliation_required";
      draft.nextStep = draft.nextStep ||
        "AI 已结束发言，等待电话网络终态后结算。";
      clearAgentCallLease(draft);
    }
    draft.updatedAt = new Date().toISOString();
    persistStoreSnapshot();
    return draft;
  });
}
