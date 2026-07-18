import { createHash, randomUUID } from "node:crypto";
import type {
  ParticipantRecordingConsentDto,
  RecordingJobStatus,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type { RecordingJobRecord } from "./recording-record.js";

const activeStatuses = new Set<RecordingJobStatus>([
  "requested",
  "starting",
  "active",
  "stopping",
]);

export function recordParticipantRecordingConsent(input: {
  sessionId: string;
  participantIdentity: string;
  policyVersion: string;
  granted: boolean;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const now = (input.now ?? new Date()).toISOString();
    const record: ParticipantRecordingConsentDto = {
      id: randomUUID(),
      sessionId: input.sessionId,
      participantIdentity: input.participantIdentity,
      policyVersion: input.policyVersion,
      status: input.granted ? "granted" : "revoked",
      ...(input.granted ? { grantedAt: now } : { revokedAt: now }),
      createdAt: now,
    };
    getStoreSnapshot().participantRecordingConsents.push(record);
    persistStoreSnapshot();
    return record;
  });
}

export function latestParticipantRecordingConsents(sessionId: string) {
  const latest = new Map<string, ParticipantRecordingConsentDto>();
  for (const record of getStoreSnapshot().participantRecordingConsents) {
    if (record.sessionId !== sessionId) continue;
    const current = latest.get(record.participantIdentity);
    if (!current || current.createdAt < record.createdAt) {
      latest.set(record.participantIdentity, record);
    }
  }
  return latest;
}

export function createRecordingConsentSnapshot(input: {
  sessionId: string;
  policyVersion: string;
  participantConsents: ParticipantRecordingConsentDto[];
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const now = (input.now ?? new Date()).toISOString();
    const consents = [...input.participantConsents].sort((left, right) =>
      left.participantIdentity.localeCompare(right.participantIdentity)
    );
    const payloadHash = hashJson(consents.map((record) => ({
      id: record.id,
      participantIdentity: record.participantIdentity,
      policyVersion: record.policyVersion,
      status: record.status,
    })));
    const existing = getStoreSnapshot().recordingConsentSnapshots.find(
      (item) => item.sessionId === input.sessionId && item.payloadHash === payloadHash,
    );
    if (existing) return existing;
    const snapshot = {
      id: randomUUID(),
      sessionId: input.sessionId,
      policyVersion: input.policyVersion,
      purpose: "call_recording" as const,
      participantConsentIds: consents.map((item) => item.id),
      participantIdentities: consents.map((item) => item.participantIdentity),
      payloadHash,
      createdAt: now,
    };
    getStoreSnapshot().recordingConsentSnapshots.push(snapshot);
    persistStoreSnapshot();
    return snapshot;
  });
}

export function beginRecordingJob(input: {
  sessionId: string;
  roomName: string;
  recordingType: RecordingJobRecord["recordingType"];
  participantIdentity?: string;
  trackId?: string;
  consentSnapshotId: string;
  retentionUntil: string;
  objectKey: string;
  idempotencyKey: string;
  requestHash: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const store = getStoreSnapshot();
    const sameKey = store.recordingJobs.find((item) =>
      item.sessionId === input.sessionId &&
      item.idempotencyKey === input.idempotencyKey
    );
    if (sameKey) {
      return sameKey.requestHash === input.requestHash
        ? { status: "replayed" as const, job: sameKey }
        : { status: "payload_conflict" as const, job: sameKey };
    }
    const active = store.recordingJobs.find((item) =>
      item.sessionId === input.sessionId && activeStatuses.has(item.status)
    );
    if (active) return { status: "active_conflict" as const, job: active };
    const now = (input.now ?? new Date()).toISOString();
    const job: RecordingJobRecord = {
      id: randomUUID(),
      sessionId: input.sessionId,
      roomName: input.roomName,
      recordingType: input.recordingType,
      participantIdentity: input.participantIdentity,
      trackId: input.trackId,
      provider: "livekit_egress",
      consentSnapshotId: input.consentSnapshotId,
      retentionUntil: input.retentionUntil,
      objectKey: input.objectKey,
      contentType: "audio/ogg",
      status: "requested",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    store.recordingJobs.push(job);
    persistStoreSnapshot();
    return { status: "created" as const, job };
  });
}

export function updateRecordingJob(input: {
  jobId: string;
  status: RecordingJobStatus;
  expectedVersion?: number;
  providerOperationId?: string;
  externalRecordingId?: string;
  errorClass?: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const job = findRecordingJob(input.jobId);
    if (!job) return { status: "not_found" as const };
    if (input.expectedVersion !== undefined && job.version !== input.expectedVersion) {
      return { status: "version_conflict" as const, job };
    }
    if (!canTransition(job.status, input.status)) {
      return { status: "invalid_transition" as const, job };
    }
    const now = (input.now ?? new Date()).toISOString();
    job.status = input.status;
    job.version += 1;
    job.updatedAt = now;
    if (input.providerOperationId) job.providerOperationId = input.providerOperationId;
    if (input.externalRecordingId) job.externalRecordingId = input.externalRecordingId;
    if (input.errorClass) job.lastErrorClass = input.errorClass.slice(0, 80);
    if (["starting", "active"].includes(input.status)) job.startedAt ??= now;
    if (["completed", "failed"].includes(input.status)) job.endedAt ??= now;
    persistStoreSnapshot();
    return { status: "updated" as const, job };
  });
}

export function findRecordingJob(jobId: string) {
  return getStoreSnapshot().recordingJobs.find((item) => item.id === jobId) ?? null;
}

export function findRecordingJobByExternalId(externalRecordingId: string) {
  return getStoreSnapshot().recordingJobs.find(
    (item) => item.externalRecordingId === externalRecordingId,
  ) ?? null;
}

export function listSessionRecordingJobs(sessionId: string) {
  return getStoreSnapshot().recordingJobs.filter((item) => item.sessionId === sessionId);
}

export function listRecoverableRecordingJobs() {
  return getStoreSnapshot().recordingJobs.filter((item) =>
    activeStatuses.has(item.status) && Boolean(item.externalRecordingId)
  );
}

function canTransition(current: RecordingJobStatus, next: RecordingJobStatus) {
  if (current === next) return true;
  const allowed: Record<RecordingJobStatus, RecordingJobStatus[]> = {
    requested: ["starting", "failed"],
    starting: ["active", "stopping", "completed", "failed"],
    active: ["stopping", "completed", "failed"],
    stopping: ["completed", "failed"],
    completed: [],
    failed: [],
  };
  return allowed[current].includes(next);
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
