import { getRecordingArtifactConfig } from "./livekit-egress-readiness.js";
import {
  listArtifactsDueForRetention,
  listArtifactsPendingVerification,
  markRecordingArtifactDeleted,
  markRecordingArtifactDeleting,
  markRecordingArtifactDeletionFailed,
  markRecordingArtifactVerificationFailed,
  markRecordingArtifactVerified,
} from "./recording-artifacts.repository.js";
import { createRecordingArtifactManifest } from "./recording-artifact-manifest.js";
import { RecordingObjectStore } from "./recording-object-store.js";
import { findRecordingJob } from "./recordings.repository.js";

export async function recoverRecordingArtifacts() {
  const configured = getRecordingArtifactConfig();
  if (!configured.ok) return emptyResult();
  const store = new RecordingObjectStore(configured.config);
  let verifiedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;
  try {
    for (const artifact of listArtifactsPendingVerification(
      configured.config.artifactBatchSize,
    )) {
      const job = findRecordingJob(artifact.recordingJobId);
      if (!job) continue;
      try {
        const verification = await store.verifyAudio(artifact.objectKey);
        const manifest = createRecordingArtifactManifest({ job, artifact, verification });
        await store.putManifest({
          objectKey: manifest.manifestObjectKey,
          body: manifest.body,
          audioSha256: verification.sha256,
        });
        markRecordingArtifactVerified({
          artifactId: artifact.id,
          ...verification,
          manifestObjectKey: manifest.manifestObjectKey,
          manifestSha256: manifest.manifestSha256,
        });
        verifiedCount += 1;
      } catch (error) {
        markRecordingArtifactVerificationFailed(artifact.id, error);
        failedCount += 1;
      }
    }
    for (const artifact of listArtifactsDueForRetention(
      configured.config.artifactBatchSize,
    )) {
      try {
        markRecordingArtifactDeleting(artifact.id);
        if (artifact.manifestObjectKey) await store.delete(artifact.manifestObjectKey);
        await store.delete(artifact.objectKey);
        markRecordingArtifactDeleted(artifact.id);
        deletedCount += 1;
      } catch (error) {
        markRecordingArtifactDeletionFailed(artifact.id, error);
        failedCount += 1;
      }
    }
  } finally {
    store.destroy();
  }
  return { verifiedCount, deletedCount, failedCount };
}

export function startRecordingArtifactRecovery(input: {
  onResult?: (result: Awaited<ReturnType<typeof recoverRecordingArtifacts>>) => void;
  onError?: (error: unknown) => void;
}) {
  const configured = getRecordingArtifactConfig();
  if (!configured.ok) return () => undefined;
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void recoverRecordingArtifacts().then(input.onResult).catch(input.onError)
      .finally(() => { running = false; });
  };
  const timer = setInterval(
    run,
    configured.config.artifactRecoveryIntervalSeconds * 1000,
  );
  timer.unref();
  run();
  return () => clearInterval(timer);
}

function emptyResult() {
  return { verifiedCount: 0, deletedCount: 0, failedCount: 0 };
}
