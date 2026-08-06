import type { CommunicationProvider } from "../communication/provider-adapters.js";
import type { ProviderOperationStatus } from "../communication/provider-operations.js";

export interface CreatePhoneOutboundCallRequest {
  targetPhone: string;
  sourceLanguage: string;
  targetLanguage: string;
  disclosureConfirmed: boolean;
  initialDtmf?: string;
}

/** Compatibility name for the existing LiveKit SIP endpoint. */
export type CreateSipOutboundCallRequest = CreatePhoneOutboundCallRequest;

export interface PhoneOutboundCallResponse {
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

/** Compatibility name for the existing LiveKit SIP endpoint. */
export type SipOutboundCallResponse = PhoneOutboundCallResponse;

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

export interface PhoneControlResponse {
  callId: string;
  sessionId: string;
  operationId: string;
  operationType: "phone_hangup";
  status: ProviderOperationStatus;
  replayed: boolean;
}
