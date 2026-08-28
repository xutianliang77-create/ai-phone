import type { PostgresPrimaryTransaction } from
  "../../infrastructure/storage/postgres-primary-store.js";
import { assertProviderOperationOutboxBinding } from
  "./provider-operation-outbox.js";
import type {
  ProviderOperationOutboxFactory,
  ProviderOperationRecord,
} from "./provider-operation-record.js";

export async function enqueueProviderOperationOutbox(
  transaction: PostgresPrimaryTransaction,
  factory: ProviderOperationOutboxFactory | undefined,
  operation: ProviderOperationRecord,
) {
  if (!factory) return;
  const event = factory(operation);
  assertProviderOperationOutboxBinding(event, operation);
  await transaction.enqueueOutbox(event);
}
