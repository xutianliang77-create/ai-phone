import { createHash } from "node:crypto";
import type {
  RecordingArtifactRecord,
  RecordingJobRecord,
} from "./recording-record.js";

export function createRecordingArtifactManifest(input: {
  job: RecordingJobRecord;
  artifact: RecordingArtifactRecord;
  verification: {
    sizeBytes: number;
    sha256: string;
    etag?: string;
    storageVersionId?: string;
  };
  verifiedAt?: Date;
}) {
  const manifestObjectKey = input.artifact.objectKey.replace(/\.ogg$/, ".manifest.json");
  if (manifestObjectKey === input.artifact.objectKey) {
    throw new Error("Recording artifact has an unsupported object key");
  }
  const manifest = {
    schemaVersion: 1,
    recordingJobId: input.job.id,
    sessionId: input.job.sessionId,
    roomName: input.job.roomName,
    consentSnapshotId: input.job.consentSnapshotId,
    recordingType: input.job.recordingType,
    participantIdentity: input.job.participantIdentity,
    trackId: input.job.trackId,
    provider: input.job.provider,
    audio: {
      objectKey: input.artifact.objectKey,
      contentType: input.artifact.contentType,
      sizeBytes: input.verification.sizeBytes,
      durationMs: input.artifact.durationMs,
      sha256: input.verification.sha256,
      etag: input.verification.etag,
      storageVersionId: input.verification.storageVersionId,
    },
    retentionUntil: input.job.retentionUntil,
    recordedAt: input.job.startedAt,
    endedAt: input.job.endedAt,
    verifiedAt: (input.verifiedAt ?? new Date()).toISOString(),
  };
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  return {
    manifest,
    body,
    manifestObjectKey,
    manifestSha256: createHash("sha256").update(body).digest("hex"),
  };
}
