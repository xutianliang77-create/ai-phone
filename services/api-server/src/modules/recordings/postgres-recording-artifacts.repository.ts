import type { Pool, QueryResultRow } from "pg";
import type { RecordingArtifactDto, RecordingJobDto } from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  bounded,
  domainCommand,
  recordDomainCommand,
  stableDomainId,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  requireRecordingArtifact,
  requireRecordingJob,
  storeRecordingRecord,
} from "./postgres-recording-uow.js";

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

export class PostgresRecordingArtifactsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async upsertAvailable(input: {
    recordingJobId: string;
    sessionId: string;
    objectKey: string;
    sizeBytes?: number;
    durationMs?: number;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "recording.artifact.available",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<RecordingArtifactDto>(command);
      if (replay) return replay;
      const jobPrimary = await transaction.read<RecordingJobDto>(
        "recordingJobs",
        input.recordingJobId,
      );
      const job = jobPrimary
        ? requireRecordingJob(jobPrimary.payload, input.recordingJobId)
        : null;
      if (!job || job.sessionId !== input.sessionId) {
        throw new Error("Recording artifact job is outside the fenced session");
      }
      const rows = await transaction.queryRead<IdRow>(`
        SELECT id FROM ai_phone.recording_artifacts
        WHERE recording_job_id = $1 AND object_key = $2
      `, [input.recordingJobId, input.objectKey]);
      const existingPrimary = rows[0]
        ? await transaction.read<RecordingArtifactDto>("recordingArtifacts", rows[0].id)
        : null;
      if (rows[0] && !existingPrimary) {
        throw new Error("Recording artifact primary record is missing");
      }
      const existing = existingPrimary
        ? requireRecordingArtifact(existingPrimary.payload, rows[0]!.id)
        : null;
      if (existing && !["pending", "available", "verification_failed"].includes(
        existing.status,
      )) return recordDomainCommand(transaction, command, existing);
      const now = (input.now ?? new Date()).toISOString();
      const artifact: RecordingArtifactDto = {
        id: existing?.id ?? stableDomainId(
          "artifact",
          `${input.recordingJobId}:${input.objectKey}`,
        ),
        recordingJobId: input.recordingJobId,
        sessionId: input.sessionId,
        objectKey: input.objectKey,
        contentType: "audio/ogg",
        status: "available",
        verificationAttempts: existing?.verificationAttempts ?? 0,
        nextVerificationAt: existing?.nextVerificationAt ?? now,
        deletionAttempts: existing?.deletionAttempts ?? 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        availableAt: existing?.availableAt ?? now,
        ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
        ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      };
      requireRecordingArtifact(artifact, artifact.id);
      const stored = await storeRecordingRecord(transaction, {
        namespace: "recordingArtifacts", recordKey: artifact.id, record: artifact,
        expectedRecordVersion: existingPrimary?.recordVersion ?? null,
        commandId: input.commandId, suffix: "recording:artifact:available",
        eventType: "recording.artifact.available",
        aggregateVersion: existingPrimary ? existingPrimary.recordVersion + 1 : 1,
        sessionId: input.sessionId,
      });
      return recordDomainCommand(transaction, command,
        requireRecordingArtifact(stored.payload, artifact.id));
    });
  }

  async transition(input: {
    artifactId: string;
    sessionId: string;
    expectedRecordVersion?: number;
    action: ArtifactAction;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    validateAction(input.action);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: `recording.artifact.${input.action.type}`,
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const primary = await transaction.read<RecordingArtifactDto>(
        "recordingArtifacts",
        input.artifactId,
      );
      if (!primary) return recordDomainCommand(transaction, command, { status: "not_found" });
      const current = requireRecordingArtifact(primary.payload, input.artifactId);
      if (current.sessionId !== input.sessionId) {
        throw new Error("Recording artifact fence mismatch");
      }
      if (input.expectedRecordVersion !== undefined &&
        primary.recordVersion !== input.expectedRecordVersion) {
        return recordDomainCommand(transaction, command, {
          status: "version_conflict", artifact: current,
        });
      }
      if (!canTransition(current.status, input.action.type)) {
        return recordDomainCommand(transaction, command, {
          status: "invalid_transition", artifact: current,
        });
      }
      const now = (input.now ?? new Date()).toISOString();
      const next = applyAction(current, input.action, now);
      const stored = await storeRecordingRecord(transaction, {
        namespace: "recordingArtifacts", recordKey: next.id, record: next,
        expectedRecordVersion: primary.recordVersion, commandId: input.commandId,
        suffix: `recording:artifact:${input.action.type}`,
        eventType: `recording.artifact.${input.action.type}`,
        aggregateVersion: primary.recordVersion + 1, sessionId: input.sessionId,
      });
      return recordDomainCommand(transaction, command, {
        status: "updated",
        artifact: requireRecordingArtifact(stored.payload, next.id),
      });
    });
  }

  async listPendingVerification(limit: number, now = new Date()) {
    return this.queryQueue(`
      artifact.status IN ('available', 'verification_failed')
      AND COALESCE(artifact.next_verification_at, artifact.updated_at) <= $1
      AND job.status = 'completed' AND job.retention_until > $1
    `, limit, now);
  }

  async listDueForRetention(limit: number, now = new Date()) {
    return this.queryQueue(`
      artifact.status <> 'deleted' AND job.ended_at IS NOT NULL
      AND job.retention_until <= $1
      AND (artifact.status <> 'deletion_failed'
        OR COALESCE(artifact.next_deletion_at, artifact.updated_at) <= $1)
    `, limit, now);
  }

  private async queryQueue(where: string, limit: number, now: Date) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || where.includes(";")) {
      throw new Error("Invalid recording artifact queue query");
    }
    const client = await this.pool.connect();
    try {
      const rows = await client.query<ArtifactRow>(`
        SELECT artifact.id, primary_record.payload
        FROM ai_phone.recording_artifacts AS artifact
        JOIN ai_phone.recording_jobs AS job ON job.id = artifact.recording_job_id
        JOIN ai_phone.projection_records AS primary_record
          ON primary_record.namespace = 'recordingArtifacts'
          AND primary_record.record_key = artifact.id
        WHERE ${where} ORDER BY artifact.updated_at, artifact.id LIMIT $2
      `, [now.toISOString(), limit]);
      return rows.rows.map((row) => requireRecordingArtifact(row.payload, row.id));
    } finally {
      client.release();
    }
  }
}

function applyAction(
  current: RecordingArtifactDto,
  action: ArtifactAction,
  now: string,
): RecordingArtifactDto {
  if (action.type === "verified") return {
    ...current, status: "verified", sizeBytes: action.sizeBytes,
    sha256: action.sha256, manifestObjectKey: action.manifestObjectKey,
    manifestSha256: action.manifestSha256, updatedAt: now, verifiedAt: now,
    ...(action.etag ? { etag: action.etag } : {}),
    ...(action.storageVersionId ? { storageVersionId: action.storageVersionId } : {}),
    nextVerificationAt: undefined,
    lastErrorClass: undefined,
  };
  if (action.type === "verification_failed") return {
    ...current, status: action.type,
    verificationAttempts: current.verificationAttempts + 1,
    lastErrorClass: action.errorClass.slice(0, 80),
    nextVerificationAt: action.retryAt, updatedAt: now,
  };
  if (action.type === "deletion_failed") return {
    ...current, status: action.type,
    deletionAttempts: current.deletionAttempts + 1,
    lastErrorClass: action.errorClass.slice(0, 80),
    nextDeletionAt: action.retryAt, updatedAt: now,
  };
  return {
    ...current, status: action.type, updatedAt: now,
    ...(action.type === "deleted" ? { deletedAt: now } : {}),
    nextDeletionAt: undefined,
    ...(action.type === "deleted" ? { lastErrorClass: undefined } : {}),
  };
}

function validateAction(action: ArtifactAction) {
  if (action.type === "verified" &&
    (!Number.isSafeInteger(action.sizeBytes) || action.sizeBytes < 0 ||
      !/^[a-f0-9]{64}$/i.test(action.sha256) ||
      !bounded(action.manifestObjectKey, 500) ||
      !/^[a-f0-9]{64}$/i.test(action.manifestSha256))) {
    throw new Error("Invalid verified recording artifact");
  }
  if ((action.type === "verification_failed" || action.type === "deletion_failed") &&
    (!bounded(action.errorClass, 80) || !Number.isFinite(Date.parse(action.retryAt)))) {
    throw new Error("Invalid recording artifact retry");
  }
}

function canTransition(current: RecordingArtifactDto["status"], next: ArtifactAction["type"]) {
  const allowed: Record<RecordingArtifactDto["status"], ArtifactAction["type"][]> = {
    pending: ["verified", "verification_failed", "deleting"],
    available: ["verified", "verification_failed", "deleting"],
    verification_failed: ["verified", "verification_failed", "deleting"],
    verified: ["deleting"], deleting: ["deleted", "deletion_failed"],
    deletion_failed: ["deleting", "deleted", "deletion_failed"], deleted: [],
  };
  return allowed[current].includes(next);
}

interface IdRow extends QueryResultRow { id: string }
interface ArtifactRow extends QueryResultRow { id: string; payload: unknown }
