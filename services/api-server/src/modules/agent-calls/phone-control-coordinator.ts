import type {
  PhoneCallControlPayload,
  SendPhoneDtmfPayload,
  TelephonyProvider,
} from "@translation/contracts";
import {
  findProviderOperation,
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
  if (["accepted", "active", "succeeded"].includes(input.operation.status)) {
    return success(input.operation, true);
  }
  if (["failed", "cancelled"].includes(input.operation.status)) {
    return failure(
      input.operation,
      false,
      input.operation.lastErrorClass ?? input.operation.status,
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
    const request = {
      operationId: input.operation.id,
      sessionId: input.operation.sessionId,
      expectedVersion: input.operation.version,
      idempotencyKey: input.operation.idempotencyKey,
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
      if (result.provider !== input.operation.provider ||
        result.result.communicationSessionId !== input.operation.sessionId ||
        result.result.providerCallId !== input.payload.providerCallId) {
        return await recordFailure(
          input.operation,
          true,
          "provider_binding_conflict",
        );
      }
      const updated = await updateProviderOperation({
        operationId: input.operation.id,
        status: "accepted",
        expectedVersion: input.operation.version,
        externalOperationId: result.externalOperationId,
        externalResourceId: result.externalResourceId ??
          result.result.providerCallId,
      });
      return success(await currentOperation(updated, input.operation), false);
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
