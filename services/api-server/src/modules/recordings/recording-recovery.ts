import { LiveKitEgressProviderAdapter } from "./livekit-egress-provider-adapter.js";
import { applyRecordingProviderJob } from "./livekit-egress-reconciliation.js";
import { getLiveKitEgressConfig } from "./livekit-egress-readiness.js";
import {
  listRecoverableRecordingJobs,
  updateRecordingJob,
} from "./recordings.repository.js";

export async function recoverRecordingJobs() {
  const config = getLiveKitEgressConfig();
  if (!config.ok) return { inspectedCount: 0, recoveredCount: 0, failedCount: 0 };
  const jobs = listRecoverableRecordingJobs();
  const provider = new LiveKitEgressProviderAdapter(config.config);
  const results = await Promise.allSettled(jobs.map(async (job) => {
    const result = await provider.get(job.externalRecordingId!);
    if (!result.ok) throw new Error(`Egress reconciliation failed: ${result.errorClass}`);
    if (!result.result) {
      updateRecordingJob({
        jobId: job.id,
        status: "failed",
        errorClass: "egress_not_found",
      });
      return;
    }
    applyRecordingProviderJob(job.id, result.result);
  }));
  const recoveredCount = results.filter((result) => result.status === "fulfilled").length;
  return {
    inspectedCount: jobs.length,
    recoveredCount,
    failedCount: jobs.length - recoveredCount,
  };
}

export function startRecordingRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<typeof recoverRecordingJobs>>) => void;
  onError?: (error: unknown) => void;
}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverRecordingJobs()
      .then(input.onResult)
      .catch(input.onError)
      .finally(() => {
        running = false;
      });
  }, input.intervalSeconds * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
