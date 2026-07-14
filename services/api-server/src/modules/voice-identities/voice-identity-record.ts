export type VoiceIdentityStatus =
  | "pending_enrollment"
  | "ready"
  | "revoked"
  | "deleted";

export interface VoiceIdentityRecord {
  id: string;
  userId: string;
  displayName: string;
  status: VoiceIdentityStatus;
  consentVersion: string;
  consentAcceptedAt: string;
  matchThreshold: number;
  embeddingRef?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  deletedAt?: string;
}
