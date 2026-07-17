import type { WebhookEvent } from "livekit-server-sdk";
import { processInboxEventOnly } from "../events/reliable-events.repository.js";
import {
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  findRecordingJobByExternalId,
  updateRecordingJob,
} from "./recordings.repository.js";
import { upsertRecordingArtifact } from "./recording-artifacts.repository.js";
import { toProviderJob } from "./livekit-egress-provider-adapter.js";

export function reconcileLiveKitEgressWebhook(event: WebhookEvent) {
  if (!event.id || !event.egressInfo ||
    !["egress_started", "egress_updated", "egress_ended"].includes(event.event)) {
    return null;
  }
  const providerJob = toProviderJob(event.egressInfo);
  const job = findRecordingJobByExternalId(providerJob.recordingId);
  if (!job || job.roomName !== providerJob.roomName) return null;
  if (providerJob.artifacts.some((artifact) => artifact.objectKey !== job.objectKey)) {
    throw new Error("LiveKit Egress artifact binding conflict");
  }
  const processed = processInboxEventOnly({
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

export function applyRecordingProviderJob(
  jobId: string,
  providerJob: ReturnType<typeof toProviderJob>,
) {
  const job = findRecordingJobByExternalId(providerJob.recordingId);
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
  const result = updateRecordingJob({
    jobId: job.id,
    status,
    errorClass: providerJob.error,
  });
  if (job.providerOperationId) {
    updateProviderOperation({
      operationId: job.providerOperationId,
      status: status === "completed" ? "succeeded" : status === "failed"
        ? "failed"
        : status === "active" ? "active" : "accepted",
      errorClass: providerJob.error,
    });
  }
  const stopOperation = findSessionProviderOperation(
    job.sessionId,
    "egress_stop",
    job.id,
  );
  if (stopOperation && ["completed", "failed"].includes(status)) {
    updateProviderOperation({
      operationId: stopOperation.id,
      status: status === "completed" ? "succeeded" : "failed",
      errorClass: providerJob.error,
    });
  }
  for (const artifact of providerJob.artifacts) {
    upsertRecordingArtifact({
      recordingJobId: job.id,
      sessionId: job.sessionId,
      objectKey: artifact.objectKey,
      sizeBytes: artifact.sizeBytes,
      durationMs: artifact.durationMs,
    });
  }
  return result.status === "updated" ? result.job : job;
}
