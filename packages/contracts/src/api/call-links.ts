import type { CommunicationProvider } from "../communication/provider-adapters.js";
import type { ProviderOperationStatus } from "../communication/provider-operations.js";

export interface CreateSipOutboundCallRequest {
  targetPhone: string;
  sourceLanguage: string;
  targetLanguage: string;
  disclosureConfirmed: boolean;
  initialDtmf?: string;
}

export interface SipOutboundCallResponse {
  callId: string;
  sessionId: string;
  roomName: string;
  operationId: string;
  provider: CommunicationProvider;
  status: ProviderOperationStatus;
  replayed: boolean;
  participantIdentity?: string;
  providerCallId?: string;
}

export interface SipDtmfRequest {
  digit: string;
  idempotencyKey: string;
}

export interface SipTransferRequest {
  targetPhone: string;
  idempotencyKey: string;
}

export interface SipControlResponse {
  callId: string;
  sessionId: string;
  operationId: string;
  operationType: "sip_dtmf" | "sip_hangup" | "sip_transfer";
  status: ProviderOperationStatus;
  replayed: boolean;
}
