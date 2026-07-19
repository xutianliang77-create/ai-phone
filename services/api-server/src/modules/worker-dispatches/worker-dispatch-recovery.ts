import { findCallLink } from "../call-links/call-links.service.js";
import { getCallLinkWorkerSupervisor } from "../call-links/call-link-worker-supervisor.js";
import { workerRuntimeProvider } from "./livekit-dispatch-readiness.js";
import { listRecoverableWorkerDispatches } from
  "./worker-dispatch-runtime.repository.js";

export async function recoverStaleWorkerDispatches(now = new Date()) {
  if (workerRuntimeProvider() !== "livekit_dispatch") {
    return { inspectedCount: 0, recoveredCount: 0, failedCount: 0 };
  }
  const stale = await listRecoverableWorkerDispatches(now);
  const runtime = getCallLinkWorkerSupervisor();
  const results = await Promise.allSettled(stale.map(async (dispatch) => {
    const call = await findCallLink(dispatch.callId);
    if (!call || call.status === "ended" || Date.parse(call.expiresAt) <= now.getTime()) {
      await runtime.stop(dispatch.callId);
      return;
    }
    await runtime.ensure(dispatch.callId);
  }));
  const recoveredCount = results.filter((result) => result.status === "fulfilled").length;
  return {
    inspectedCount: stale.length,
    recoveredCount,
    failedCount: stale.length - recoveredCount,
  };
}

export function startWorkerDispatchRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverStaleWorkerDispatches>>) => void;
  onError?: (error: unknown) => void;
}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverStaleWorkerDispatches()
      .then(input.onResult)
      .catch(input.onError)
      .finally(() => {
        running = false;
      });
  }, input.intervalSeconds * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
