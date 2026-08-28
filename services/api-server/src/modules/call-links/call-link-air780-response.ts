import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import type { CallLinkRecord } from "./call-links.service.js";

export function air780OutboundResponse(
  record: CallLinkRecord,
  operation: ProviderOperationRecord,
  replayed: boolean,
  participantIdentity?: string,
  providerCallId?: string,
) {
  return {
    callId: record.callId,
    sessionId: record.sessionId,
    roomName: record.roomName,
    operationId: operation.id,
    provider: operation.provider,
    status: operation.status,
    replayed,
    ...(participantIdentity ? { participantIdentity } : {}),
    ...(providerCallId ? { providerCallId } : {}),
  };
}

export function air780HangupResponse(
  callId: string,
  operation: ProviderOperationRecord,
  replayed: boolean,
) {
  return {
    callId,
    sessionId: operation.sessionId,
    operationId: operation.id,
    operationType: "phone_hangup" as const,
    status: operation.status,
    replayed,
  };
}

export function air780DtmfResponse(
  callId: string,
  operation: ProviderOperationRecord,
  replayed: boolean,
) {
  return {
    callId,
    sessionId: operation.sessionId,
    operationId: operation.id,
    operationType: "phone_dtmf" as const,
    status: operation.status,
    replayed,
  };
}
