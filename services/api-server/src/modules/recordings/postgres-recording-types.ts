import type {
  ParticipantRecordingConsentDto,
  RecordingJobDto,
  RecordingJobStatus,
} from "@translation/contracts";
import type { PostgresAggregateFence } from
  "../../infrastructure/storage/postgres-primary-store.js";

interface RecordingCommandInput {
  commandId: string;
  requestHash: string;
  fence: PostgresAggregateFence;
  now?: Date;
}

export interface RecordRecordingConsentInput extends RecordingCommandInput {
  sessionId: string;
  participantIdentity: string;
  policyVersion: string;
  granted: boolean;
  source?: ParticipantRecordingConsentDto["source"];
  participantRole?: ParticipantRecordingConsentDto["participantRole"];
  joinType?: ParticipantRecordingConsentDto["joinType"];
  generation?: number;
  runtimeEventId?: string;
  evidenceHash?: string;
  observedAt?: string;
  expiresAt?: string;
}

export interface CreateRecordingSnapshotInput extends RecordingCommandInput {
  sessionId: string;
  policyVersion: string;
  participantConsents: ParticipantRecordingConsentDto[];
}

export interface BeginRecordingJobInput extends RecordingCommandInput {
  sessionId: string;
  roomName: string;
  recordingType: RecordingJobDto["recordingType"];
  participantIdentity?: string;
  trackId?: string;
  consentSnapshotId: string;
  retentionUntil: string;
  objectKey: string;
  idempotencyKey: string;
}

export interface UpdateRecordingJobInput extends RecordingCommandInput {
  jobId: string;
  sessionId: string;
  status: RecordingJobStatus;
  expectedVersion?: number;
  providerOperationId?: string;
  externalRecordingId?: string;
  errorClass?: string;
}
