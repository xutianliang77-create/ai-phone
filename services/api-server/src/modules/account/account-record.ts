export type AccountStatus = "active" | "deletion_requested" | "deleted";

export interface AccountRecord {
  id: string;
  phoneHash: string;
  phoneMasked: string;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  deletionRequestedAt?: string;
}

export interface AuthSessionRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface SmsOtpChallengeRecord {
  id: string;
  phoneHash: string;
  phoneMasked: string;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  deliveryProvider?: string;
  deliveryId?: string;
  requesterHash?: string;
  failedAttempts?: number;
  lockedAt?: string;
  supersededAt?: string;
  consumedAt?: string;
}

export type AccountConsentType =
  "initial_privacy" | "voice_processing" | "call_record" | "agent_authorize";

export type AccountConsentScene =
  "app_start" | "realtime_online" | "call_link" | "ai_calling_agent";

export interface AccountConsentRecord {
  id: string;
  userId: string;
  consentType: AccountConsentType;
  version: string;
  scene?: AccountConsentScene;
  acceptedAt: string;
  recordedAt: string;
  source: string;
  locale?: string;
}
