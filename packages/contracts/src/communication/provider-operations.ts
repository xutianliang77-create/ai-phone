import type { CommunicationProvider } from "./provider-adapters.js";

export type ProviderOperationType =
  | "phone_outbound"
  | "phone_dtmf"
  | "phone_hangup"
  | "phone_reconcile"
  | "translation_type_to_speak"
  | "translation_uplink_control"
  | "sip_outbound"
  | "sip_dtmf"
  | "sip_hangup"
  | "sip_transfer"
  | "sip_inbound"
  | "sip_inbound_close"
  | "sip_consult"
  | "sip_consult_move"
  | "sip_consult_end"
  | "dispatch_create"
  | "dispatch_delete"
  | "egress_start"
  | "egress_stop"
  | "ingress_create"
  | "ingress_delete";

export type ProviderOperationStatus =
  | "in_flight"
  | "accepted"
  | "unknown"
  | "active"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ProviderOperationDto {
  id: string;
  sessionId: string;
  provider: CommunicationProvider;
  operationType: ProviderOperationType;
  operationKey?: string;
  idempotencyKey: string;
  requestHash: string;
  status: ProviderOperationStatus;
  attempt: number;
  version: number;
  externalOperationId?: string;
  externalResourceId?: string;
  lastErrorClass?: string;
  traceId?: string;
  startedAt: string;
  acceptedAt?: string;
  answeredAt?: string;
  completionObservedAt?: string;
  completionObservedEvent?: string;
  endedAt?: string;
  updatedAt: string;
}
