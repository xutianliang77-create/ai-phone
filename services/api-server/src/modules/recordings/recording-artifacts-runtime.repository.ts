import type { RecordingArtifactDto } from "@translation/contracts";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./recording-artifacts.repository.js";

type ArtifactAction = {
  type: "verified";
  sizeBytes: number;
  sha256: string;
  etag?: string;
  storageVersionId?: string;
  manifestObjectKey: string;
  manifestSha256: string;
} | {
  type: "verification_failed" | "deletion_failed";
  errorClass: string;
  retryAt: string;
} | {
  type: "deleting" | "deleted";
};

export async function upsertRecordingArtifact(
  input: Parameters<typeof legacy.upsertRecordingArtifact>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.upsertRecordingArtifact(input);
  const requestHash = repositoryRequestHash(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.recordingArtifacts.upsertAvailable({
      ...input,
      commandId: commandId(input.sessionId, "artifact-available", 0, requestHash),
      requestHash,
      fence,
    }),
  );
}

export async function markRecordingArtifactVerified(
  input: Parameters<typeof legacy.markRecordingArtifactVerified>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markRecordingArtifactVerified(input);
  }
  return transitionArtifact(input.artifactId, input.now, () => ({
    type: "verified",
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    etag: input.etag,
    storageVersionId: input.storageVersionId,
    manifestObjectKey: input.manifestObjectKey,
    manifestSha256: input.manifestSha256,
  }));
}

export async function markRecordingArtifactVerificationFailed(
  artifactId: string,
  error: unknown,
  now = new Date(),
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markRecordingArtifactVerificationFailed(artifactId, error, now);
  }
  return transitionArtifact(artifactId, now, (artifact) => ({
    type: "verification_failed",
    errorClass: classifyError(error),
    retryAt: retryAt(now, artifact.verificationAttempts + 1),
  }));
}

export async function markRecordingArtifactDeleting(
  artifactId: string,
  now = new Date(),
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markRecordingArtifactDeleting(artifactId, now);
  }
  return transitionArtifact(artifactId, now, () => ({ type: "deleting" }));
}

export async function markRecordingArtifactDeleted(
  artifactId: string,
  now = new Date(),
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markRecordingArtifactDeleted(artifactId, now);
  }
  return transitionArtifact(artifactId, now, () => ({ type: "deleted" }));
}

export async function markRecordingArtifactDeletionFailed(
  artifactId: string,
  error: unknown,
  now = new Date(),
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.markRecordingArtifactDeletionFailed(artifactId, error, now);
  }
  return transitionArtifact(artifactId, now, (artifact) => ({
    type: "deletion_failed",
    errorClass: classifyError(error),
    retryAt: retryAt(now, artifact.deletionAttempts + 1),
  }));
}

export function listRecordingArtifacts(jobId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordingArtifacts.listJob(jobId)
    : Promise.resolve(legacy.listRecordingArtifacts(jobId));
}

export function listArtifactsPendingVerification(limit: number, now = new Date()) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordingArtifacts.listPendingVerification(limit, now)
    : Promise.resolve(legacy.listArtifactsPendingVerification(limit, now));
}

export function listArtifactsDueForRetention(limit: number, now = new Date()) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordingArtifacts.listDueForRetention(limit, now)
    : Promise.resolve(legacy.listArtifactsDueForRetention(limit, now));
}

async function transitionArtifact(
  artifactId: string,
  now: Date | undefined,
  action: (artifact: RecordingArtifactDto) => ArtifactAction,
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    throw new Error("PostgreSQL artifact transition requires postgres runtime");
  }
  const artifact = await runtime.postgres.recordingArtifacts.find(artifactId);
  if (!artifact || artifact.status === "deleted") return null;
  const requested = action(artifact);
  const requestHash = repositoryRequestHash({ artifactId, action: requested });
  const result = await withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: artifact.sessionId },
    (fence) => runtime.postgres.recordingArtifacts.transition({
      artifactId,
      sessionId: artifact.sessionId,
      action: requested,
      commandId: commandId(
        artifact.sessionId,
        `artifact-${requested.type}`,
        artifact.verificationAttempts + artifact.deletionAttempts,
        requestHash,
      ),
      requestHash,
      fence,
      now,
    }),
  );
  return transitionResult(result);
}

function transitionResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const value = result as { status?: unknown; artifact?: RecordingArtifactDto };
  return value.status === "not_found" ? null : value.artifact ?? null;
}

function commandId(
  aggregateId: string,
  operation: string,
  version: number,
  requestHash: string,
) {
  return repositoryCommandId({ aggregateId, operation, version, requestHash });
}

function retryAt(now: Date, attempts: number) {
  const seconds = Math.min(3600, 2 ** Math.min(10, attempts));
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function classifyError(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: unknown }).name ?? "object_storage_error")
      .slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "object_storage_error";
}
