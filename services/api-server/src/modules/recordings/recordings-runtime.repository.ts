import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./recordings.repository.js";

export async function recordParticipantRecordingConsent(
  input: Parameters<typeof legacy.recordParticipantRecordingConsent>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.recordParticipantRecordingConsent(input);
  }
  const now = input.now ?? new Date();
  const requestHash = repositoryRequestHash(input.runtimeEventId
    ? { ...input, now: undefined }
    : { ...input, now: now.toISOString() });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.recordings.recordConsent({
      ...input,
      now,
      commandId: commandId(
        input.sessionId,
        input.runtimeEventId ? `consent:${input.runtimeEventId}` : "consent",
        0,
        requestHash,
      ),
      requestHash,
      fence,
    }),
  );
}

export function latestParticipantRecordingConsents(sessionId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordings.latestConsents(sessionId)
    : Promise.resolve(legacy.latestParticipantRecordingConsents(sessionId));
}

export async function createRecordingConsentSnapshot(
  input: Parameters<typeof legacy.createRecordingConsentSnapshot>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") {
    return legacy.createRecordingConsentSnapshot(input);
  }
  const requestHash = repositoryRequestHash({
    sessionId: input.sessionId,
    policyVersion: input.policyVersion,
    participantConsents: [...input.participantConsents]
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.recordings.createSnapshot({
      ...input,
      commandId: commandId(input.sessionId, "consent-snapshot", 0, requestHash),
      requestHash,
      fence,
    }),
  );
}

export async function beginRecordingJob(
  input: Parameters<typeof legacy.beginRecordingJob>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.beginRecordingJob(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.recordings.beginJob({
      ...input,
      commandId: commandId(input.sessionId, "job-begin", 0, input.requestHash),
      fence,
    }),
  );
}

export async function updateRecordingJob(
  input: Parameters<typeof legacy.updateRecordingJob>[0],
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateRecordingJob(input);
  const job = await runtime.postgres.recordings.findJob(input.jobId);
  if (!job) return { status: "not_found" as const };
  const requestHash = repositoryRequestHash(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: job.sessionId },
    (fence) => runtime.postgres.recordings.updateJob({
      ...input,
      sessionId: job.sessionId,
      commandId: commandId(
        job.sessionId,
        `job-${input.status}`,
        input.expectedVersion ?? job.version,
        requestHash,
      ),
      requestHash,
      fence,
    }),
  );
}

export function findRecordingJob(jobId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordings.findJob(jobId)
    : Promise.resolve(legacy.findRecordingJob(jobId));
}

export function findRecordingJobByExternalId(externalRecordingId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordings.findJobByExternalId(externalRecordingId)
    : Promise.resolve(legacy.findRecordingJobByExternalId(externalRecordingId));
}

export function listSessionRecordingJobs(sessionId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordings.listSessionJobs(sessionId)
    : Promise.resolve(legacy.listSessionRecordingJobs(sessionId));
}

export function listRecoverableRecordingJobs() {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.recordings.listRecoverableJobs()
    : Promise.resolve(legacy.listRecoverableRecordingJobs());
}

function commandId(
  aggregateId: string,
  operation: string,
  version: number,
  requestHash: string,
) {
  return repositoryCommandId({ aggregateId, operation, version, requestHash });
}
