import type {
  PhoneCallControlPayload,
  SendPhoneDtmfPayload,
  TelephonyProvider,
} from "@translation/contracts";
import {
  findProviderOperation,
  retryProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";

type PhoneControlInput = {
  operation: ProviderOperationRecord;
  provider: TelephonyProvider;
  timeoutMs: number;
} & ({
  action: "dtmf";
  payload: SendPhoneDtmfPayload;
} | {
  action: "hangup";
  payload: PhoneCallControlPayload;
});

export async function executePhoneControl(input: PhoneControlInput) {
  const issue = bindingIssue(input);
  if (issue) return failure(input.operation, false, issue);
  let operation = input.operation;
  if (["accepted", "active", "succeeded"].includes(operation.status)) {
    return success(operation, true);
  }
  let retried = false;
  if (operation.status === "failed") {
    // Air maps a command that was never dispatched to failed/unavailable.
    // Any outcome with possible side effects is stored as unknown and stays quarantined.
    if (operation.lastErrorClass !== "unavailable") {
      return failure(operation, false, operation.lastErrorClass ?? "failed");
    }
    const retry = await retryProviderOperation({
      operationId: operation.id,
      expectedVersion: operation.version,
    });
    if (retry.status !== "retried") {
      const current = "operation" in retry ? retry.operation : operation;
      return failure(
        current,
        current.status === "in_flight" || current.status === "unknown",
        current.lastErrorClass ?? "hangup_retry_conflict",
      );
    }
    operation = retry.operation;
    retried = true;
  }
  if (operation.status === "cancelled") {
    return failure(operation, false, operation.lastErrorClass ?? "cancelled");
  }
  if (operation.status === "unknown") {
    return failure(
      operation,
      true,
      operation.lastErrorClass ?? "unknown",
    );
  }
  try {
    const request = {
      operationId: operation.id,
      sessionId: operation.sessionId,
      expectedVersion: operation.version,
      idempotencyKey: operation.idempotencyKey,
      deadlineAt: new Date(
        Date.now() + boundedTimeout(input.timeoutMs),
      ).toISOString(),
      payload: input.payload,
    };
    const result = input.action === "dtmf"
      ? await input.provider.sendPhoneDtmf({
          ...request,
          payload: input.payload,
        })
      : await input.provider.hangupPhoneCall({
          ...request,
          payload: input.payload,
        });
    if (result.ok) {
      if (result.provider !== operation.provider ||
        result.result.communicationSessionId !== operation.sessionId ||
        result.result.providerCallId !== input.payload.providerCallId) {
        return await recordFailure(
          operation,
          true,
          "provider_binding_conflict",
        );
      }
      const updated = await updateProviderOperation({
        operationId: operation.id,
        status: "accepted",
        expectedVersion: operation.version,
        externalOperationId: result.externalOperationId,
        externalResourceId: result.externalResourceId ??
          result.result.providerCallId,
      });
      return success(await currentOperation(updated, operation), retried);
    }
    return await recordFailure(
      operation,
      result.reconciliationRequired,
      result.errorClass,
      result.externalOperationId,
      result.externalResourceId,
    );
  } catch {
    return await recordFailure(operation, true, "provider_exception");
  }
}

function bindingIssue(input: PhoneControlInput) {
  const expectedType = input.action === "dtmf" ? "phone_dtmf" : "phone_hangup";
  if (input.operation.operationType !== expectedType ||
    input.operation.sessionId !== input.payload.communicationSessionId) {
    return "operation_binding_conflict";
  }
  if (input.operation.provider !== "air780_volte" ||
    !input.payload.deviceLease) return "provider_binding_conflict";
  return null;
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

function success(operation: ProviderOperationRecord, replayed: boolean) {
  return { ok: true as const, operation, replayed };
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
