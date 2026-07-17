import type { Pool, QueryResultRow } from "pg";
import type {
  ParticipantRecordingConsentDto,
  RecordingConsentSnapshotDto,
  RecordingJobDto,
  RecordingJobStatus,
} from "@translation/contracts";
import {
  PostgresPrimaryStore,
  type PostgresAggregateFence,
} from "../../infrastructure/storage/postgres-primary-store.js";
import {
  assertDomainFence,
  domainCommand,
  recordDomainCommand,
  stableDomainId,
} from "../../infrastructure/storage/postgres-domain-record-uow.js";
import {
  activeRecordingStatuses,
  canTransitionRecording,
  requireRecordingConsent,
  requireRecordingJob,
  requireRecordingSnapshot,
  recordingConsentPayloadHash,
  storeRecordingRecord,
} from "./postgres-recording-uow.js";

export class PostgresRecordingsRepository {
  private readonly primary: PostgresPrimaryStore;

  constructor(private readonly pool: Pick<Pool, "connect">) {
    this.primary = new PostgresPrimaryStore(pool);
  }

  async recordConsent(input: {
    sessionId: string;
    participantIdentity: string;
    policyVersion: string;
    granted: boolean;
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "recording.consent.record",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<ParticipantRecordingConsentDto>(command);
        if (replay) return replay;
        const now = (input.now ?? new Date()).toISOString();
        const consent: ParticipantRecordingConsentDto = {
          id: stableDomainId("consent", input.commandId),
          sessionId: input.sessionId,
          participantIdentity: input.participantIdentity,
          policyVersion: input.policyVersion,
          status: input.granted ? "granted" : "revoked",
          ...(input.granted ? { grantedAt: now } : { revokedAt: now }),
          createdAt: now,
        };
        requireRecordingConsent(consent, consent.id);
        const stored = await storeRecordingRecord(transaction, {
          namespace: "participantRecordingConsents",
          recordKey: consent.id,
          record: consent,
          expectedRecordVersion: null,
          commandId: input.commandId,
          suffix: "recording:consent",
          eventType: "recording.consent.recorded",
          aggregateVersion: 1,
          sessionId: input.sessionId,
        });
        return recordDomainCommand(transaction, command,
          requireRecordingConsent(stored.payload, consent.id));
      },
    );
  }

  async createSnapshot(input: {
    sessionId: string;
    policyVersion: string;
    participantConsents: ParticipantRecordingConsentDto[];
    commandId: string;
    requestHash: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "recording.consent.snapshot",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(
      input.fence,
      async (transaction) => {
        const replay = await transaction
          .readCommandResult<RecordingConsentSnapshotDto>(command);
        if (replay) return replay;
        const consents = [...input.participantConsents].sort((left, right) =>
          left.participantIdentity.localeCompare(right.participantIdentity)
        );
        for (const supplied of consents) {
          if (supplied.sessionId !== input.sessionId) {
            throw new Error("Recording consent is outside the fenced session");
          }
          const primary = await transaction.read<ParticipantRecordingConsentDto>(
            "participantRecordingConsents",
            supplied.id,
          );
          const stored = primary
            ? requireRecordingConsent(primary.payload, supplied.id)
            : null;
          if (!stored || recordingConsentPayloadHash([stored]) !==
            recordingConsentPayloadHash([supplied])) {
            throw new Error("Recording consent snapshot input is not authoritative");
          }
        }
        const payloadHash = recordingConsentPayloadHash(consents);
        const rows = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.recording_consent_snapshots
          WHERE session_id = $1 AND payload_hash = $2
        `, [input.sessionId, payloadHash]);
        if (rows[0]) {
          const existing = await transaction.read<RecordingConsentSnapshotDto>(
            "recordingConsentSnapshots",
            rows[0].id,
          );
          if (!existing) throw new Error("Recording snapshot primary record is missing");
          return recordDomainCommand(transaction, command,
            requireRecordingSnapshot(existing.payload, rows[0].id));
        }
        const snapshot: RecordingConsentSnapshotDto = {
          id: stableDomainId("consent_snapshot", `${input.sessionId}:${payloadHash}`),
          sessionId: input.sessionId,
          policyVersion: input.policyVersion,
          purpose: "call_recording",
          participantConsentIds: consents.map((item) => item.id),
          participantIdentities: consents.map((item) => item.participantIdentity),
          payloadHash,
          createdAt: (input.now ?? new Date()).toISOString(),
        };
        requireRecordingSnapshot(snapshot, snapshot.id);
        const stored = await storeRecordingRecord(transaction, {
          namespace: "recordingConsentSnapshots",
          recordKey: snapshot.id,
          record: snapshot,
          expectedRecordVersion: null,
          commandId: input.commandId,
          suffix: "recording:snapshot",
          eventType: "recording.consent_snapshot.created",
          aggregateVersion: 1,
          sessionId: input.sessionId,
        });
        return recordDomainCommand(transaction, command,
          requireRecordingSnapshot(stored.payload, snapshot.id));
      },
    );
  }

  async beginJob(input: {
    sessionId: string;
    roomName: string;
    recordingType: RecordingJobDto["recordingType"];
    participantIdentity?: string;
    trackId?: string;
    consentSnapshotId: string;
    retentionUntil: string;
    objectKey: string;
    idempotencyKey: string;
    requestHash: string;
    commandId: string;
    fence: PostgresAggregateFence;
    now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId,
      commandType: "recording.job.begin",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(
      input.fence,
      async (transaction) => {
        const replay = await transaction.readCommandResult<{
          status: string; job: RecordingJobDto;
        }>(command);
        if (replay) return replay;
        const snapshotPrimary = await transaction.read<RecordingConsentSnapshotDto>(
          "recordingConsentSnapshots",
          input.consentSnapshotId,
        );
        const snapshot = snapshotPrimary
          ? requireRecordingSnapshot(snapshotPrimary.payload, input.consentSnapshotId)
          : null;
        if (!snapshot || snapshot.sessionId !== input.sessionId) {
          throw new Error("Recording consent snapshot is outside the fenced session");
        }
        const rows = await transaction.queryRead<JobIdRow>(`
          SELECT id, request_hash FROM ai_phone.recording_jobs
          WHERE session_id = $1 AND idempotency_key = $2
        `, [input.sessionId, input.idempotencyKey]);
        if (rows[0]) {
          const existing = await this.readJob(transaction, rows[0].id);
          return recordDomainCommand(transaction, command, {
            status: rows[0].request_hash === input.requestHash
              ? "replayed" : "payload_conflict",
            job: existing,
          });
        }
        const active = await transaction.queryRead<IdRow>(`
          SELECT id FROM ai_phone.recording_jobs
          WHERE session_id = $1 AND status = ANY($2::text[]) LIMIT 1
        `, [input.sessionId, [...activeRecordingStatuses]]);
        if (active[0]) return recordDomainCommand(transaction, command, {
          status: "active_conflict",
          job: await this.readJob(transaction, active[0].id),
        });
        const now = (input.now ?? new Date()).toISOString();
        const job: RecordingJobDto = {
          id: stableDomainId("recording", `${input.sessionId}:${input.idempotencyKey}`),
          sessionId: input.sessionId,
          roomName: input.roomName,
          recordingType: input.recordingType,
          ...(input.participantIdentity
            ? { participantIdentity: input.participantIdentity }
            : {}),
          ...(input.trackId ? { trackId: input.trackId } : {}),
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
        requireRecordingJob(job, job.id);
        const stored = await storeRecordingRecord(transaction, {
          namespace: "recordingJobs", recordKey: job.id, record: job,
          expectedRecordVersion: null, commandId: input.commandId,
          suffix: "recording:job:begin", eventType: "recording.job.requested",
          aggregateVersion: 1, sessionId: input.sessionId,
        });
        return recordDomainCommand(transaction, command, {
          status: "created",
          job: requireRecordingJob(stored.payload, job.id),
        });
      },
    );
  }

  async updateJob(input: {
    jobId: string; sessionId: string; status: RecordingJobStatus;
    expectedVersion?: number; providerOperationId?: string;
    externalRecordingId?: string; errorClass?: string;
    commandId: string; requestHash: string; fence: PostgresAggregateFence; now?: Date;
  }) {
    assertDomainFence(input.fence, "communication_session", input.sessionId);
    const command = domainCommand(input.fence, {
      commandId: input.commandId, commandType: "recording.job.update",
      requestHash: input.requestHash,
    });
    return this.primary.withAggregateTransaction(input.fence, async (transaction) => {
      const replay = await transaction.readCommandResult<unknown>(command);
      if (replay) return replay;
      const primary = await transaction.read<RecordingJobDto>("recordingJobs", input.jobId);
      if (!primary) return recordDomainCommand(transaction, command, { status: "not_found" });
      const current = requireRecordingJob(primary.payload, input.jobId);
      if (current.sessionId !== input.sessionId) throw new Error("Recording job fence mismatch");
      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        return recordDomainCommand(transaction, command, { status: "version_conflict", job: current });
      }
      if (!canTransitionRecording(current.status, input.status)) {
        return recordDomainCommand(transaction, command, { status: "invalid_transition", job: current });
      }
      if (current.externalRecordingId && input.externalRecordingId &&
        current.externalRecordingId !== input.externalRecordingId) {
        return recordDomainCommand(transaction, command, { status: "external_id_conflict", job: current });
      }
      const now = (input.now ?? new Date()).toISOString();
      const next: RecordingJobDto = {
        ...current, status: input.status, version: current.version + 1, updatedAt: now,
        ...(input.providerOperationId ? { providerOperationId: input.providerOperationId } : {}),
        ...(input.externalRecordingId ? { externalRecordingId: input.externalRecordingId } : {}),
        ...(input.errorClass ? { lastErrorClass: input.errorClass.slice(0, 80) } : {}),
      };
      if (["starting", "active"].includes(input.status)) next.startedAt ??= now;
      if (["completed", "failed"].includes(input.status)) next.endedAt ??= now;
      const stored = await storeRecordingRecord(transaction, {
        namespace: "recordingJobs", recordKey: next.id, record: next,
        expectedRecordVersion: primary.recordVersion, commandId: input.commandId,
        suffix: "recording:job:update", eventType: `recording.job.${next.status}`,
        aggregateVersion: next.version, sessionId: input.sessionId,
      });
      return recordDomainCommand(transaction, command, {
        status: "updated", job: requireRecordingJob(stored.payload, next.id),
      });
    });
  }

  private async readJob(transaction: Parameters<typeof storeRecordingRecord>[0], id: string) {
    const primary = await transaction.read<RecordingJobDto>("recordingJobs", id);
    if (!primary) throw new Error("Recording job primary record is missing");
    return requireRecordingJob(primary.payload, id);
  }
}

interface IdRow extends QueryResultRow { id: string }
interface JobIdRow extends QueryResultRow { id: string; request_hash: string }
