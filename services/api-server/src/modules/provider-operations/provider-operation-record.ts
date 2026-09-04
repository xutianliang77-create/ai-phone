import type { ProviderOperationDto } from "@translation/contracts";

export type ProviderOperationRecord = ProviderOperationDto;

export interface ProviderOperationOutboxEvent {
  id: string;
  idempotencyKey: string;
  sessionId: string;
  eventType: string;
  eventVersion: 1;
  payload: unknown;
}

export type ProviderOperationOutboxFactory = (
  operation: ProviderOperationRecord,
) => ProviderOperationOutboxEvent;
