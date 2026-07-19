import type { RecordingJobDto } from "@translation/contracts";
import { listRecordingArtifacts } from
  "./recording-artifacts-runtime.repository.js";

export async function recordingResponse(job: RecordingJobDto, replayed: boolean) {
  const artifacts = await listRecordingArtifacts(job.id);
  return {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status,
    recordingType: job.recordingType,
    participantIdentity: job.participantIdentity,
    trackId: job.trackId,
    contentType: job.contentType,
    consentSnapshotId: job.consentSnapshotId,
    providerOperationId: job.providerOperationId,
    externalRecordingId: job.externalRecordingId,
    retentionUntil: job.retentionUntil,
    replayed,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      durationMs: artifact.durationMs,
      sha256: artifact.sha256,
      manifestSha256: artifact.manifestSha256,
      verifiedAt: artifact.verifiedAt,
      deletedAt: artifact.deletedAt,
      lastErrorClass: artifact.lastErrorClass,
    })),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}
