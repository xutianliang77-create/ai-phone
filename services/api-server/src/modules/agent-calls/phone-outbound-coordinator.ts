import type {
  PlacePhoneCallPayload,
  TelephonyProvider,
} from "@translation/contracts";
import {
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import { isAgentCallDialOperation } from "./agent-call-provider-profile.js";

export async function executePhoneOutbound(input: {
  operation: ProviderOperationRecord;
  provider: TelephonyProvider;
  payload: PlacePhoneCallPayload;
  timeoutMs: number;
}) {
  const bindingIssue = operationBindingIssue(input.operation, input.payload);
  if (bindingIssue) return failure(input.operation, false, bindingIssue);
  if (["accepted", "active", "succeeded"].includes(input.operation.status)) {
    return success(input.operation, input.payload.participantIdentity, true);
  }
  if (["failed", "cancelled"].includes(input.operation.status)) {
    return failure(
      input.operation,
      false,
      input.operation.lastErrorClass ?? "failed",
    );
  }
  if (input.operation.status === "unknown") {
    return failure(
      input.operation,
      true,
      input.operation.lastErrorClass ?? "unknown",
    );
  }
  try {
    const result = await input.provider.placePhoneCall({
      operationId: input.operation.id,
      sessionId: input.operation.sessionId,
      expectedVersion: input.operation.version,
      idempotencyKey: input.operation.idempotencyKey,
      deadlineAt: new Date(Date.now() + boundedTimeout(input.timeoutMs)).toISOString(),
      payload: input.payload,
    });
    if (result.ok) {
      if (result.provider !== input.operation.provider ||
        result.result.communicationSessionId !== input.operation.sessionId ||
        !result.result.providerCallId) {
        return await recordFailure(input.operation, true, "provider_binding_conflict");
      }
      const updated = await updateProviderOperation({
        operationId: input.operation.id,
        status: "accepted",
        expectedVersion: input.operation.version,
        externalOperationId: result.externalOperationId,
        externalResourceId: result.externalResourceId ?? result.result.providerCallId,
      });
      const operation = await currentOperation(updated, input.operation);
      return {
        ...success(operation, result.result.participantIdentity, false),
        providerCallId: result.result.providerCallId,
      };
    }
    return await recordFailure(
      input.operation,
      result.reconciliationRequired,
      result.errorClass,
      result.externalOperationId,
      result.externalResourceId,
    );
  } catch {
    return await recordFailure(input.operation, true, "provider_exception");
  }
}

function operationBindingIssue(
  operation: ProviderOperationRecord,
  payload: PlacePhoneCallPayload,
) {
  if (operation.sessionId !== payload.communicationSessionId ||
    !isAgentCallDialOperation(operation)) return "operation_binding_conflict";
  const expectedProvider = payload.transport === "air780_volte"
    ? "air780_volte"
    : "livekit_sip";
  return operation.provider === expectedProvider ? null : "provider_binding_conflict";
}

async function recordFailure(
  operation: ProviderOperationRecord,
  reconciliationRequired: boolean,
  errorClass: string,
  externalOperationId?: string,
  externalResourceId?: string,
) {
  const updated = await updateProviderOperation({
    operationId: operation.id,
    status: reconciliationRequired ? "unknown" : "failed",
    expectedVersion: operation.version,
    errorClass,
    externalOperationId,
    externalResourceId,
  });
  return failure(
    await currentOperation(updated, operation),
    reconciliationRequired,
    errorClass,
  );
}

function success(
  operation: ProviderOperationRecord,
  participantIdentity: string,
  replayed: boolean,
) {
  return {
    ok: true as const,
    operation,
    replayed,
    participantIdentity,
    providerCallId: operation.provider === "air780_volte"
      ? operation.externalResourceId ?? operation.externalOperationId ?? operation.id
      : operation.externalOperationId ?? operation.externalResourceId ?? operation.id,
  };
}

function failure(
  operation: ProviderOperationRecord,
  reconciliationRequired: boolean,
  errorClass: string,
) {
  return {
    ok: false as const,
    operation,
    reconciliationRequired,
    errorClass,
  };
}

async function currentOperation(
  result: Awaited<ReturnType<typeof updateProviderOperation>>,
  fallback: ProviderOperationRecord,
) {
  return "operation" in result && result.operation
    ? result.operation
    : await findProviderOperation(fallback.id) ?? fallback;
}

function boundedTimeout(value: number) {
  return Number.isInteger(value) && value >= 100 && value <= 120_000
    ? value
    : 10_000;
}
