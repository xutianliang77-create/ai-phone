import type { CallLinkPublicTtsAttemptEvent } from "@translation/contracts";
import type { PublicModelRuntimeSnapshot } from "../models/public-model-runtime-config.js";

export type CallLinkStatus = "created" | "active" | "ended";

export interface CallLinkMetadata {
  roomName: string;
  roomProvider: "livekit";
  joinUrl: string;
  hostUrl: string;
  expiresAt: string;
  purpose?: "human_call" | "voice_agent";
  guestTicket?: CallGuestTicketRecord;
  translationControl?: CallLinkTranslationControlState;
  diagnosticMarkers?: CallLinkDiagnosticMarker[];
  /** Credential-free public Tencent TTS snapshot. Present only when the
   * explicit compatibility lane is enabled and server qualification succeeds. */
  publicTts?: CallLinkPublicTtsBinding;
  publicTtsAttempts?: CallLinkPublicTtsAttemptRecord[];
}

export interface CallLinkPublicTtsBinding {
  schemaVersion: 1;
  boundAt: string;
  configuration: PublicModelRuntimeSnapshot;
}

export interface CallLinkPublicTtsAttemptRecord {
  createdAt: string;
  updatedAt: string;
  event: CallLinkPublicTtsAttemptEvent;
}

export type CallLinkDiagnosticCategory =
  | "cannot_hear_remote"
  | "callee_cannot_hear_translation"
  | "translation_incorrect"
  | "unexpected_audio";

export interface CallLinkDiagnosticMarker {
  id: string;
  category: CallLinkDiagnosticCategory;
  createdAt: string;
  controlGeneration?: number;
  dispatchGeneration?: number;
  dialOperationId?: string;
}

export interface CallLinkTranslationControlState {
  sourceLanguage: "zh" | "en";
  targetLanguage: "zh" | "en";
  uplinkPaused: boolean;
  controlGeneration: number;
  updatedAt: string;
  lastSettledOperationId?: string;
  lastSettledControlGeneration?: number;
  lastSettledDispatchGeneration?: number;
  lastSettledRequestedPaused?: boolean;
  lastSettledSucceeded?: boolean;
  pending?: {
    operationId: string;
    idempotencyKey: string;
    requestedPaused: boolean;
    controlGeneration: number;
    dispatchGeneration: number;
    resumePreparedAt?: string;
  };
}

export interface CallGuestTicketRecord {
  callId: string;
  sessionId: string;
  role: "guest";
  nonceHash: string;
  ticketHash: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export type CallParticipantRole = "host" | "guest" | "worker";
export type CallJoinType = "app" | "web" | "worker" | "sip";
export type CallLegStatus = "active" | "ended";

export interface CallLegRecord {
  id: string;
  participantIdentity: string;
  participantRole: CallParticipantRole;
  joinType: CallJoinType;
  status: CallLegStatus;
  joinedAt: string;
  endedAt?: string;
}
