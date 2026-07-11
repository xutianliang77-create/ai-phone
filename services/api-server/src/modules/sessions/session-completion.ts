import {
  endSession,
  updateConsumedSeconds,
} from "./sessions.repository.js";
import { settleSessionUsage } from "./session-usage-settlement.js";

export interface CompleteSessionWithUsageOptions {
  billableSeconds?: number;
}

export function completeSessionWithUsage(
  sessionId: string,
  options: CompleteSessionWithUsageOptions = {},
) {
  const result = endSession(sessionId);
  if (!result) return null;
  if (result.wasAlreadyEnded) return result.session;

  const settlement = settleSessionUsage(
    result.session,
    typeof options.billableSeconds === "number"
      ? { billableSeconds: options.billableSeconds }
      : {},
  );
  const updatedSession = updateConsumedSeconds(
    result.session.id,
    settlement.billableSeconds,
  );
  return updatedSession ?? result.session;
}
