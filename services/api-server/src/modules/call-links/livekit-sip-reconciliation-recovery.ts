import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import { expirePendingLiveKitSipCompletion } from "./livekit-sip-reconciliation.js";

export async function recoverPendingLiveKitSipCompletions(options: {
  now?: Date;
  graceSeconds?: number;
} = {}) {
  const now = options.now ?? new Date();
  const graceMs = Math.max(5, options.graceSeconds ?? 30) * 1000;
  const candidates = getStoreSnapshot().providerOperations.filter((operation) =>
    operation.provider === "livekit_sip" &&
    operation.operationType === "sip_outbound" &&
    operation.status === "unknown" &&
    !operation.answeredAt &&
    completionIsStale(operation.completionObservedAt, now, graceMs)
  );
  let recoveredCount = 0;
  await Promise.all(candidates.map((operation) =>
    withSessionWriteLock(operation.sessionId, async () => {
      const result = await expirePendingLiveKitSipCompletion(operation.id);
      if (!result.terminal) return;
      recoveredCount += 1;
      await getCallLinkWorkerSupervisor().stop(operation.sessionId);
    })
  ));
  return { inspectedCount: candidates.length, recoveredCount };
}

export function startLiveKitSipReconciliationRecovery(options: {
  intervalSeconds: number;
  graceSeconds: number;
  onResult?: (result: Awaited<ReturnType<
    typeof recoverPendingLiveKitSipCompletions
  >>) => void;
  onError?: (error: unknown) => void;
}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverPendingLiveKitSipCompletions({
      graceSeconds: options.graceSeconds,
    }).then((result) => options.onResult?.(result))
      .catch((error) => options.onError?.(error))
      .finally(() => { running = false; });
  }, Math.max(1, options.intervalSeconds) * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

function completionIsStale(
  value: string | undefined,
  now: Date,
  graceMs: number,
) {
  if (!value) return false;
  const observedAt = Date.parse(value);
  return Number.isFinite(observedAt) && now.getTime() - observedAt >= graceMs;
}
