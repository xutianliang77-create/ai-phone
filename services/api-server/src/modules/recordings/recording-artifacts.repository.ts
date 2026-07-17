import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type { RecordingArtifactRecord } from "./recording-record.js";

export function upsertRecordingArtifact(input: {
  recordingJobId: string;
  sessionId: string;
  objectKey: string;
  sizeBytes?: number;
  durationMs?: number;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const now = (input.now ?? new Date()).toISOString();
    const existing = store.recordingArtifacts.find((item) =>
      item.recordingJobId === input.recordingJobId && item.objectKey === input.objectKey
    );
    const artifact: RecordingArtifactRecord = existing ?? {
      id: randomUUID(),
      recordingJobId: input.recordingJobId,
      sessionId: input.sessionId,
      objectKey: input.objectKey,
      contentType: "audio/ogg",
      status: "available",
      verificationAttempts: 0,
      nextVerificationAt: now,
      deletionAttempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    artifact.verificationAttempts ??= 0;
    artifact.deletionAttempts ??= 0;
    if (!existing || ["pending", "verification_failed"].includes(existing.status)) {
      artifact.status = "available";
      artifact.nextVerificationAt ??= now;
    }
    artifact.updatedAt = now;
    artifact.availableAt ??= now;
    if (input.sizeBytes !== undefined) artifact.sizeBytes = input.sizeBytes;
    if (input.durationMs !== undefined) artifact.durationMs = input.durationMs;
    if (!existing) store.recordingArtifacts.push(artifact);
    persistStoreSnapshot();
    return artifact;
  });
}

export function markRecordingArtifactVerified(input: {
  artifactId: string;
  sizeBytes: number;
  sha256: string;
  etag?: string;
  storageVersionId?: string;
  manifestObjectKey: string;
  manifestSha256: string;
  now?: Date;
}) {
  return mutate(input.artifactId, (artifact, now) => {
    artifact.status = "verified";
    artifact.sizeBytes = input.sizeBytes;
    artifact.sha256 = input.sha256;
    artifact.etag = input.etag;
    artifact.storageVersionId = input.storageVersionId;
    artifact.manifestObjectKey = input.manifestObjectKey;
    artifact.manifestSha256 = input.manifestSha256;
    artifact.verifiedAt = now;
    artifact.nextVerificationAt = undefined;
    artifact.lastErrorClass = undefined;
  }, input.now);
}

export function markRecordingArtifactVerificationFailed(
  artifactId: string,
  error: unknown,
  now = new Date(),
) {
  return mutate(artifactId, (artifact, timestamp) => {
    artifact.status = "verification_failed";
    artifact.verificationAttempts = (artifact.verificationAttempts ?? 0) + 1;
    artifact.lastErrorClass = errorClass(error);
    artifact.nextVerificationAt = retryAt(now, artifact.verificationAttempts);
    artifact.updatedAt = timestamp;
  }, now);
}

export function markRecordingArtifactDeleting(artifactId: string, now = new Date()) {
  return mutate(artifactId, (artifact) => {
    artifact.status = "deleting";
    artifact.nextDeletionAt = undefined;
  }, now);
}

export function markRecordingArtifactDeleted(artifactId: string, now = new Date()) {
  return mutate(artifactId, (artifact, timestamp) => {
    artifact.status = "deleted";
    artifact.deletedAt = timestamp;
    artifact.nextDeletionAt = undefined;
    artifact.lastErrorClass = undefined;
  }, now);
}

export function markRecordingArtifactDeletionFailed(
  artifactId: string,
  error: unknown,
  now = new Date(),
) {
  return mutate(artifactId, (artifact) => {
    artifact.status = "deletion_failed";
    artifact.deletionAttempts = (artifact.deletionAttempts ?? 0) + 1;
    artifact.lastErrorClass = errorClass(error);
    artifact.nextDeletionAt = retryAt(now, artifact.deletionAttempts);
  }, now);
}

export function listRecordingArtifacts(jobId: string) {
  return getStoreSnapshot().recordingArtifacts.filter(
    (item) => item.recordingJobId === jobId,
  );
}

export function listArtifactsPendingVerification(limit: number, now = new Date()) {
  return getStoreSnapshot().recordingArtifacts.filter((artifact) => {
    if (!["available", "verification_failed"].includes(artifact.status)) return false;
    if (Date.parse(artifact.nextVerificationAt ?? artifact.updatedAt) > now.getTime()) return false;
    const job = getStoreSnapshot().recordingJobs.find((item) =>
      item.id === artifact.recordingJobId
    );
    return job?.status === "completed" && Date.parse(job.retentionUntil) > now.getTime();
  }).slice(0, limit);
}

export function listArtifactsDueForRetention(limit: number, now = new Date()) {
  return getStoreSnapshot().recordingArtifacts.filter((artifact) => {
    if (artifact.status === "deleted") return false;
    if (artifact.status === "deletion_failed" &&
      Date.parse(artifact.nextDeletionAt ?? artifact.updatedAt) > now.getTime()) return false;
    const job = getStoreSnapshot().recordingJobs.find((item) =>
      item.id === artifact.recordingJobId
    );
    return Boolean(job?.endedAt) && Date.parse(job!.retentionUntil) <= now.getTime();
  }).slice(0, limit);
}

function mutate(
  artifactId: string,
  update: (artifact: RecordingArtifactRecord, now: string) => void,
  now = new Date(),
) {
  return runStoreTransaction(() => {
    const artifact = getStoreSnapshot().recordingArtifacts.find(
      (item) => item.id === artifactId,
    );
    if (!artifact || artifact.status === "deleted") return null;
    const timestamp = now.toISOString();
    update(artifact, timestamp);
    artifact.updatedAt = timestamp;
    persistStoreSnapshot();
    return artifact;
  });
}

function retryAt(now: Date, attempts: number) {
  const seconds = Math.min(3600, 2 ** Math.min(10, attempts));
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function errorClass(error: unknown) {
  if (error && typeof error === "object" && "name" in error) {
    return String((error as { name?: unknown }).name ?? "object_storage_error").slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "object_storage_error";
}
