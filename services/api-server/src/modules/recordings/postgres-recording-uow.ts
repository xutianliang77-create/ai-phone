import type {
  ParticipantRecordingConsentDto,
  RecordingArtifactDto,
  RecordingConsentSnapshotDto,
  RecordingJobDto,
  RecordingJobStatus,
} from "@translation/contracts";
import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import {
  bounded,
  domainEventId,
  enqueueDomainEvent,
  validTimestamp,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";

export const activeRecordingStatuses = new Set<RecordingJobStatus>([
  "requested",
  "starting",
  "active",
  "stopping",
]);

export function requireRecordingJob(value: unknown, jobId: string) {
  const job = value as Partial<RecordingJobDto> | null;
  if (!job || job.id !== jobId || !bounded(job.sessionId ?? "", 160) ||
    !bounded(job.roomName ?? "", 200) || job.provider !== "livekit_egress" ||
    !["room_audio", "participant", "track"].includes(job.recordingType ?? "") ||
    !bounded(job.objectKey ?? "", 500) || job.contentType !== "audio/ogg" ||
    !activeOrTerminal(job.status) || !positive(job.version) ||
    !bounded(job.idempotencyKey ?? "", 200) ||
    !bounded(job.requestHash ?? "", 128) || (job.requestHash?.length ?? 0) < 16 ||
    !validTimestamp(job.retentionUntil) || !validTimestamp(job.createdAt) ||
    !validTimestamp(job.updatedAt)) throw new Error("Invalid PostgreSQL recording job");
  return job as RecordingJobDto;
}

export function requireRecordingConsent(value: unknown, consentId: string) {
  const consent = value as Partial<ParticipantRecordingConsentDto> | null;
  if (!consent || consent.id !== consentId ||
    !bounded(consent.sessionId ?? "", 160) ||
    !bounded(consent.participantIdentity ?? "", 200) ||
    !bounded(consent.policyVersion ?? "", 120) ||
    !["granted", "revoked"].includes(consent.status ?? "") ||
    !validTimestamp(consent.createdAt) || !validConsentTrust(consent)) {
    throw new Error("Invalid PostgreSQL recording consent");
  }
  return consent as ParticipantRecordingConsentDto;
}

export function requireRecordingSnapshot(value: unknown, snapshotId: string) {
  const snapshot = value as Partial<RecordingConsentSnapshotDto> | null;
  if (!snapshot || snapshot.id !== snapshotId ||
    !bounded(snapshot.sessionId ?? "", 160) || snapshot.purpose !== "call_recording" ||
    !Array.isArray(snapshot.participantConsentIds) ||
    !Array.isArray(snapshot.participantIdentities) ||
    !bounded(snapshot.payloadHash ?? "", 128) ||
    !validTimestamp(snapshot.createdAt)) {
    throw new Error("Invalid PostgreSQL recording consent snapshot");
  }
  return snapshot as RecordingConsentSnapshotDto;
}

export function requireRecordingArtifact(value: unknown, artifactId: string) {
  const artifact = value as Partial<RecordingArtifactDto> | null;
  if (!artifact || artifact.id !== artifactId ||
    !bounded(artifact.recordingJobId ?? "", 200) ||
    !bounded(artifact.sessionId ?? "", 160) ||
    !bounded(artifact.objectKey ?? "", 500) || artifact.contentType !== "audio/ogg" ||
    !validTimestamp(artifact.createdAt) || !validTimestamp(artifact.updatedAt)) {
    throw new Error("Invalid PostgreSQL recording artifact");
  }
  return artifact as RecordingArtifactDto;
}

export async function storeRecordingRecord<T>(
  transaction: PostgresPrimaryTransaction,
  input: {
    namespace: string;
    recordKey: string;
    record: T;
    expectedRecordVersion: number | null;
    commandId: string;
    suffix: string;
    eventType: string;
    aggregateVersion: number;
    sessionId: string;
  },
) {
  const eventId = domainEventId(input.commandId, input.suffix);
  const stored = await transaction.mutate<T>({
    eventId,
    namespace: input.namespace,
    recordKey: input.recordKey,
    operation: "upsert",
    payload: input.record,
    expectedRecordVersion: input.expectedRecordVersion,
  });
  if (!stored) throw new Error("PostgreSQL recording record was not stored");
  await enqueueDomainEvent(transaction, {
    eventId,
    eventType: input.eventType,
    aggregateVersion: input.aggregateVersion,
    sessionId: input.sessionId,
    payload: { record: stored.payload },
  });
  return stored;
}

export function canTransitionRecording(current: RecordingJobStatus, next: RecordingJobStatus) {
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

export function recordingConsentPayloadHash(
  consents: ParticipantRecordingConsentDto[],
) {
  return createHash("sha256").update(JSON.stringify(consents.map((record) => ({
    id: record.id,
    participantIdentity: record.participantIdentity,
    policyVersion: record.policyVersion,
    status: record.status,
    source: record.source,
    participantRole: record.participantRole,
    joinType: record.joinType,
    generation: record.generation,
    runtimeEventId: record.runtimeEventId,
    evidenceHash: record.evidenceHash,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
  })))).digest("hex");
}

function activeOrTerminal(value: unknown): value is RecordingJobStatus {
  return typeof value === "string" && [
    ...activeRecordingStatuses,
    "completed",
    "failed",
  ].includes(value as RecordingJobStatus);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validConsentTrust(consent: Partial<ParticipantRecordingConsentDto>) {
  if (!consent.source || consent.source === "participant_token") return true;
  return consent.source === "voice_agent_runtime" &&
    consent.participantRole === "guest" && consent.joinType === "sip" &&
    positive(consent.generation) && bounded(consent.runtimeEventId ?? "", 128) &&
    /^[a-f0-9]{64}$/.test(consent.evidenceHash ?? "") &&
    validTimestamp(consent.observedAt) && validTimestamp(consent.expiresAt);
}
import { createHash } from "node:crypto";
