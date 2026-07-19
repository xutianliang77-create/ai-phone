import type {
  CommunicationProvider,
  ProviderOperationStatus,
  ProviderOperationType,
} from "@translation/contracts";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./provider-operations.repository.js";

export async function beginProviderOperation(input: {
  sessionId: string;
  provider: CommunicationProvider;
  operationType: ProviderOperationType;
  operationKey?: string;
  idempotencyKey: string;
  requestHash: string;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.beginProviderOperation(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.providerOperations.begin({ ...input, fence }),
  );
}

export async function updateProviderOperation(input: {
  operationId: string;
  status: ProviderOperationStatus;
  expectedVersion?: number;
  externalOperationId?: string;
  externalResourceId?: string;
  errorClass?: string;
  completionObservedAt?: string;
  completionObservedEvent?: string;
  now?: Date;
}) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateProviderOperation(input);
  const operation = await runtime.postgres.providerOperations.find(input.operationId);
  if (!operation) return { status: "not_found" as const };
  const requestHash = repositoryRequestHash(input);
  const commandId = repositoryCommandId({
    aggregateId: operation.sessionId,
    operation: `provider-operation-${input.status}`,
    version: input.expectedVersion ?? operation.version,
    requestHash,
  });
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: operation.sessionId },
    (fence) => runtime.postgres.providerOperations.update({
      ...input,
      commandId,
      fence,
    }),
  );
}

export function findProviderOperation(operationId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.providerOperations.find(operationId)
    : Promise.resolve(legacy.findProviderOperation(operationId));
}

export function findSessionProviderOperation(
  sessionId: string,
  operationType: ProviderOperationType,
  operationKey?: string,
) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.providerOperations.findSession(
      sessionId,
      operationType,
      operationKey,
    )
    : Promise.resolve(legacy.findSessionProviderOperation(
      sessionId,
      operationType,
      operationKey,
    ));
}

export function findActiveProviderOperations(operationType: ProviderOperationType) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.providerOperations.findActive(operationType)
    : Promise.resolve(legacy.findActiveProviderOperations(operationType));
}
