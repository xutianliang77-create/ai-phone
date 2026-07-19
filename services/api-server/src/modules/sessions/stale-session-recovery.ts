import { isTerminalRealtimeSessionState } from "@translation/contracts";
import { releaseUsageHold } from "../usage/usage-hold-runtime.service.js";
import {
  endCallLegs,
  endSession,
  findSession,
} from "./sessions-runtime.repository.js";
import { listStaleSessionCandidates } from
  "./sessions-recovery.repository.js";
import { withSessionWriteLock } from "./session-write-coordinator.js";

export interface StaleSessionRecoveryResult {
  inspectedCount: number;
  recoveredCount: number;
  releasedHoldCount: number;
}

export async function recoverStaleRealtimeSessions(options: {
  now?: Date;
  graceSeconds?: number;
} = {}): Promise<StaleSessionRecoveryResult> {
  const now = options.now ?? new Date();
  const graceMs = Math.max(0, options.graceSeconds ?? 300) * 1000;
  let inspectedCount = 0;
  let recoveredCount = 0;
  let releasedHoldCount = 0;

  const cutoff = new Date(now.getTime() - graceMs);
  const candidateIds = (await listStaleSessionCandidates(cutoff))
    .map((session) => session.id);
  inspectedCount = candidateIds.length;

  await Promise.all(candidateIds.map((sessionId) =>
    withSessionWriteLock(sessionId, async () => {
      const session = await findSession(sessionId);
      if (!session || isTerminalRealtimeSessionState(session.status)) return;
      const lastActivityMs = Date.parse(
        session.lastActivityAt ?? session.createdAt,
      );
      if (!Number.isFinite(lastActivityMs) ||
          now.getTime() - lastActivityMs <= graceMs) return;

      const result = await endSession(session.id, now);
      if (!result || result.wasAlreadyEnded) return;
      if (result.session.endedAt) {
        await endCallLegs(result.session.id, result.session.endedAt);
      }
      recoveredCount += 1;
      if (await releaseUsageHold(session.userId, session.id)) {
        releasedHoldCount += 1;
      }
    }),
  ));

  return { inspectedCount, recoveredCount, releasedHoldCount };
}

export function startStaleRealtimeSessionRecovery(options: {
  intervalSeconds: number;
  graceSeconds: number;
  onResult?: (result: StaleSessionRecoveryResult) => void;
  onError?: (error: unknown) => void;
}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverStaleRealtimeSessions({ graceSeconds: options.graceSeconds })
      .then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error))
      .finally(() => { running = false; });
  }, Math.max(1, options.intervalSeconds) * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
