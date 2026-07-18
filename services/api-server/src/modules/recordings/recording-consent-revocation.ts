import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { LiveKitEgressProviderAdapter } from "./livekit-egress-provider-adapter.js";
import {
  getLiveKitEgressConfig,
  type LiveKitEgressConfig,
} from "./livekit-egress-readiness.js";
import { applyRecordingProviderJob } from "./livekit-egress-reconciliation.js";
import {
  findRecordingJob,
  listSessionRecordingJobs,
  updateRecordingJob,
} from "./recordings-runtime.repository.js";

export async function stopRecordingsForConsentRevocation(sessionId: string) {
  const configured = getLiveKitEgressConfig();
  const jobs = await withSessionWriteLock(sessionId, async () => {
    const active = (await listSessionRecordingJobs(sessionId)).filter((job) =>
      ["requested", "starting", "active", "stopping"].includes(job.status)
    );
    for (const job of active) {
      if (!job.externalRecordingId) {
        await updateRecordingJob({
          jobId: job.id,
          status: "failed",
          expectedVersion: job.version,
          errorClass: "recording_consent_revoked",
        });
      } else if (job.status !== "stopping") {
        await updateRecordingJob({
          jobId: job.id,
          status: "stopping",
          expectedVersion: job.version,
          errorClass: "recording_consent_revoked",
        });
      }
    }
    return active.filter((job) => Boolean(job.externalRecordingId));
  });
  if (jobs.length === 0) return { attempted: 0, failed: 0 };
  if (!configured.ok) {
    return { attempted: jobs.length, failed: jobs.length };
  }
  let failed = 0;
  for (const job of jobs) {
    if (!await stopOne(job.id, configured.config)) failed += 1;
  }
  return { attempted: jobs.length, failed };
}

async function stopOne(jobId: string, config: LiveKitEgressConfig) {
  const job = await findRecordingJob(jobId);
  if (!job?.externalRecordingId) return true;
  const operation = (await beginProviderOperation({
    sessionId: job.sessionId,
    provider: "livekit_egress",
    operationType: "egress_stop",
    operationKey: job.id,
    idempotencyKey: `egress-stop:${job.id}`,
    requestHash: job.externalRecordingId,
  })).operation;
  const result = await new LiveKitEgressProviderAdapter(config).stop({
    operationId: operation.id,
    sessionId: job.sessionId,
    expectedVersion: operation.version,
    idempotencyKey: operation.idempotencyKey,
    deadlineAt: new Date(
      Date.now() + config.requestTimeoutSeconds * 1000,
    ).toISOString(),
    payload: { recordingId: job.externalRecordingId },
  });
  if (!result.ok) {
    await updateProviderOperation({
      operationId: operation.id,
      status: result.reconciliationRequired ? "unknown" : "failed",
      errorClass: result.errorClass,
    });
    if (!result.reconciliationRequired) {
      await updateRecordingJob({
        jobId: job.id,
        status: "failed",
        errorClass: "recording_consent_revoked",
      });
    }
    return false;
  }
  await updateProviderOperation({
    operationId: operation.id,
    status: "accepted",
    externalOperationId: result.result.recordingId,
    externalResourceId: result.result.recordingId,
  });
  await applyRecordingProviderJob(job.id, result.result);
  return true;
}
