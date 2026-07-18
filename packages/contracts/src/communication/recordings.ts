export type ParticipantRecordingConsentStatus = "granted" | "revoked";
export type ParticipantRecordingConsentSource =
  | "participant_token"
  | "voice_agent_runtime";

export interface ParticipantRecordingConsentDto {
  id: string;
  sessionId: string;
  participantIdentity: string;
  policyVersion: string;
  status: ParticipantRecordingConsentStatus;
  source?: ParticipantRecordingConsentSource;
  participantRole?: "host" | "guest";
  joinType?: "app" | "web" | "sip";
  generation?: number;
  runtimeEventId?: string;
  evidenceHash?: string;
  observedAt?: string;
  expiresAt?: string;
  grantedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface RecordingConsentSnapshotDto {
  id: string;
  sessionId: string;
  policyVersion: string;
  purpose: "call_recording";
  participantConsentIds: string[];
  participantIdentities: string[];
  payloadHash: string;
  createdAt: string;
}

export type RecordingJobStatus =
  | "requested"
  | "starting"
  | "active"
  | "stopping"
  | "completed"
  | "failed";

export interface RecordingJobDto {
  id: string;
  sessionId: string;
  roomName: string;
  recordingType: "room_audio" | "participant" | "track";
  participantIdentity?: string;
  trackId?: string;
  provider: "livekit_egress";
  consentSnapshotId: string;
  retentionUntil: string;
  objectKey: string;
  contentType: "audio/ogg";
  status: RecordingJobStatus;
  idempotencyKey: string;
  requestHash: string;
  version: number;
  providerOperationId?: string;
  externalRecordingId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
  lastErrorClass?: string;
}

export type RecordingArtifactStatus =
  | "pending"
  | "available"
  | "verification_failed"
  | "verified"
  | "deleting"
  | "deletion_failed"
  | "deleted";

export interface RecordingArtifactDto {
  id: string;
  recordingJobId: string;
  sessionId: string;
  objectKey: string;
  contentType: "audio/ogg";
  status: RecordingArtifactStatus;
  sizeBytes?: number;
  durationMs?: number;
  sha256?: string;
  etag?: string;
  storageVersionId?: string;
  manifestObjectKey?: string;
  manifestSha256?: string;
  verificationAttempts: number;
  nextVerificationAt?: string;
  deletionAttempts: number;
  nextDeletionAt?: string;
  lastErrorClass?: string;
  availableAt?: string;
  verifiedAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}
