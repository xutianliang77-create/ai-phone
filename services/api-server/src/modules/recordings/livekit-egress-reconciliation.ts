import type { WebhookEvent } from "livekit-server-sdk";
import { processInboxEventOnlyAsync } from
  "../events/reliable-events-runtime.repository.js";
import {
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import {
  findRecordingJobByExternalId,
  updateRecordingJob,
} from "./recordings-runtime.repository.js";
import { upsertRecordingArtifact } from
  "./recording-artifacts-runtime.repository.js";
import { toProviderJob } from "./livekit-egress-provider-adapter.js";

export async function reconcileLiveKitEgressWebhook(event: WebhookEvent) {
  if (!event.id || !event.egressInfo ||
    !["egress_started", "egress_updated", "egress_ended"].includes(event.event)) {
    return null;
  }
  const providerJob = toProviderJob(event.egressInfo);
  const job = await findRecordingJobByExternalId(providerJob.recordingId);
  if (!job || job.roomName !== providerJob.roomName) return null;
  if (providerJob.artifacts.some((artifact) => artifact.objectKey !== job.objectKey)) {
    throw new Error("LiveKit Egress artifact binding conflict");
  }
  const processed = await processInboxEventOnlyAsync({
    eventId: `livekit:${event.id}`,
    sessionId: job.sessionId,
    eventType: `livekit.${event.event}`,
    payload: {
      id: event.id,
      event: event.event,
      createdAt: event.createdAt.toString(),
      egressId: providerJob.recordingId,
      roomName: providerJob.roomName,
      status: providerJob.status,
      artifacts: providerJob.artifacts.map((artifact) => ({
        objectKey: artifact.objectKey,
        sizeBytes: artifact.sizeBytes,
        durationMs: artifact.durationMs,
      })),
    },
    process: () => applyRecordingProviderJob(job.id, providerJob),
  });
  return {
    duplicate: processed.duplicate,
    eventId: event.id,
    recordingId: job.id,
    status: processed.result?.status ?? job.status,
  };
}

export async function applyRecordingProviderJob(
  jobId: string,
  providerJob: ReturnType<typeof toProviderJob>,
) {
  const job = await findRecordingJobByExternalId(providerJob.recordingId);
  if (!job || job.id !== jobId) return null;
  const status = providerJob.status === "complete"
    ? "completed" as const
    : providerJob.status === "failed"
    ? "failed" as const
    : providerJob.status === "ending"
    ? "stopping" as const
    : providerJob.status === "active"
    ? "active" as const
    : "starting" as const;
  const result = await updateRecordingJob({
    jobId: job.id,
    status,
    errorClass: providerJob.error,
  });
  if (job.providerOperationId) {
    await updateProviderOperation({
      operationId: job.providerOperationId,
      status: status === "completed" ? "succeeded" : status === "failed"
        ? "failed"
        : status === "active" ? "active" : "accepted",
      errorClass: providerJob.error,
    });
  }
  const stopOperation = await findSessionProviderOperation(
    job.sessionId,
    "egress_stop",
    job.id,
  );
  if (stopOperation && ["completed", "failed"].includes(status)) {
    await updateProviderOperation({
      operationId: stopOperation.id,
      status: status === "completed" ? "succeeded" : "failed",
      errorClass: providerJob.error,
    });
  }
  for (const artifact of providerJob.artifacts) {
    await upsertRecordingArtifact({
      recordingJobId: job.id,
      sessionId: job.sessionId,
      objectKey: artifact.objectKey,
      sizeBytes: artifact.sizeBytes,
      durationMs: artifact.durationMs,
    });
  }
  return result.status === "updated" ? result.job : job;
}
