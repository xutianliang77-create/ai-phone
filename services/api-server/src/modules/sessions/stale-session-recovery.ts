import { isTerminalRealtimeSessionState } from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import { releaseUsageHold } from "../usage/usage.service.js";

export interface StaleSessionRecoveryResult {
  inspectedCount: number;
  recoveredCount: number;
  releasedHoldCount: number;
}

export function recoverStaleRealtimeSessions(options: {
  now?: Date;
  graceSeconds?: number;
} = {}): StaleSessionRecoveryResult {
  const now = options.now ?? new Date();
  const graceMs = Math.max(0, options.graceSeconds ?? 300) * 1000;
  const store = getStoreSnapshot();
  let inspectedCount = 0;
  let recoveredCount = 0;
  let releasedHoldCount = 0;

  for (const session of store.sessions) {
    if (isTerminalRealtimeSessionState(session.status)) continue;
    inspectedCount += 1;
    const lastActivityMs = Date.parse(
      session.lastActivityAt ?? session.createdAt,
    );
    if (!Number.isFinite(lastActivityMs) || now.getTime() - lastActivityMs <= graceMs) {
      continue;
    }

    session.status = "ended";
    session.endedAt = now.toISOString();
    session.lastActivityAt = session.endedAt;
    recoveredCount += 1;
    if (releaseUsageHold(session.userId, session.id)) {
      releasedHoldCount += 1;
    }
  }

  if (recoveredCount > 0) persistStoreSnapshot();
  return { inspectedCount, recoveredCount, releasedHoldCount };
}
