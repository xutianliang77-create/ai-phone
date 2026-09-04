import type {
  ProviderOperationOutboxFactory,
  ProviderOperationRecord,
} from "./provider-operation-record.js";

export function attachProviderOperationOutbox(
  factory: ProviderOperationOutboxFactory | undefined,
  operation: ProviderOperationRecord,
  now: Date | undefined,
  input: {
    existing: Array<{
      idempotencyKey: string;
      sessionId: string;
      eventType: string;
      payload: unknown;
    }>;
    push: (event: {
      idempotencyKey: string;
      sessionId: string;
      eventType: string;
      payload: unknown;
      attempts: number;
      availableAt: string;
      createdAt: string;
    }) => void;
  },
) {
  if (!factory) return false;
  const event = factory(operation);
  assertProviderOperationOutboxBinding(event, operation);
  const existing = input.existing.find(
    (candidate) => candidate.idempotencyKey === event.idempotencyKey,
  );
  if (existing) {
    if (existing.sessionId !== event.sessionId ||
      existing.eventType !== event.eventType ||
      JSON.stringify(existing.payload) !== JSON.stringify(event.payload)) {
      throw new Error("Provider operation outbox payload conflict");
    }
    return false;
  }
  const createdAt = (now ?? new Date()).toISOString();
  input.push({
    idempotencyKey: event.idempotencyKey,
    sessionId: event.sessionId,
    eventType: event.eventType,
    payload: event.payload,
    attempts: 0,
    availableAt: createdAt,
    createdAt,
  });
  return true;
}

export function assertProviderOperationOutboxBinding(
  event: ReturnType<ProviderOperationOutboxFactory>,
  operation: ProviderOperationRecord,
) {
  if (event.sessionId !== operation.sessionId || event.eventVersion !== 1) {
    throw new Error("Provider operation outbox binding failed");
  }
}
