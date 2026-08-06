import { createHmac } from "node:crypto";
import type {
  PhoneCallControlPayload,
  PlacePhoneCallPayload,
  TelephonyProvider,
} from "@translation/contracts";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import type { CallLinkRecord } from "./call-links.service.js";
import { registerCallLeg } from "./call-links.service.js";
import type { CreatePhoneOutboundCallRequest } from
  "@translation/contracts";
import { executePhoneOutbound } from "../agent-calls/phone-outbound-coordinator.js";
import { executePhoneControl } from "../agent-calls/phone-control-coordinator.js";
import {
  getAir780CallLinkTelephonyRuntime,
  setAir780CallLinkTelephonyRuntimeForTests,
  type Air780CallLinkTelephonyRuntime,
} from "./air780-call-link-telephony-runtime.js";

export {
  getAir780CallLinkTelephonyRuntime,
  setAir780CallLinkTelephonyRuntimeForTests,
};
export type { Air780CallLinkTelephonyRuntime } from
  "./air780-call-link-telephony-runtime.js";

export function beginAir780CallLinkOutbound(input: {
  record: CallLinkRecord;
  request: CreatePhoneOutboundCallRequest;
}) {
  return beginProviderOperation({
    sessionId: input.record.sessionId,
    provider: "air780_volte",
    operationType: "phone_outbound",
    idempotencyKey: `air780-outbound:${input.record.sessionId}`,
    requestHash: air780CallLinkOutboundRequestHash(input.record, input.request),
  });
}

export async function executeAir780CallLinkOutbound(input: {
  record: CallLinkRecord;
  request: CreatePhoneOutboundCallRequest;
  operation: ProviderOperationRecord;
}) {
  if (["accepted", "active", "succeeded"].includes(input.operation.status)) {
    return {
      ok: true as const,
      operation: input.operation,
      replayed: true,
      providerCallId: input.operation.externalResourceId ??
        input.operation.externalOperationId ?? input.operation.id,
      participantIdentity: `${input.record.sessionId}:guest:air`,
    };
  }
  if (["failed", "cancelled"].includes(input.operation.status)) {
    return failure(input.operation, false, input.operation.lastErrorClass ?? "failed");
  }
  if (input.operation.status === "unknown") {
    return failure(input.operation, true, input.operation.lastErrorClass ?? "unknown");
  }
  const runtimeResult = getAir780CallLinkTelephonyRuntime();
  if (!runtimeResult.ok) {
    return failure(input.operation, false, runtimeResult.issues.join("; "));
  }
  let payload: PlacePhoneCallPayload;
  try {
    payload = await runtimeResult.runtime.buildPayload({
      record: input.record,
      operation: input.operation,
      targetPhone: input.request.targetPhone,
    });
    const guestLeg = await registerCallLeg({
      callId: input.record.callId,
      participantIdentity: payload.participantIdentity,
      participantRole: "guest",
      // Air780 is the PSTN leg; retain the existing telephony join type used
      // by the track-access and recording gates.
      joinType: "sip",
    });
    if (!guestLeg) throw new Error("Air780 call guest leg could not be registered");
  } catch (error) {
    const updated = await updateProviderOperation({
      operationId: input.operation.id,
      status: "failed",
      expectedVersion: input.operation.version,
      errorClass: error instanceof Error ? error.name : "air_device_binding",
    });
    return failure(
      "operation" in updated && updated.operation ? updated.operation : input.operation,
      false,
      error instanceof Error ? error.name : "air_device_binding",
    );
  }
  const result = await executePhoneOutbound({
    operation: input.operation,
    provider: runtimeResult.runtime.adapter,
    payload,
    timeoutMs: runtimeResult.runtime.timeoutMs,
  });
  if (!result.ok && !result.reconciliationRequired) {
    await runtimeResult.runtime.releasePayload(payload).catch(() => undefined);
  }
  return {
    ...result,
    payload,
  };
}

export async function executeAir780CallLinkHangup(input: {
  operation: ProviderOperationRecord;
  provider: TelephonyProvider;
  payload: PhoneCallControlPayload;
  timeoutMs: number;
}) {
  return executePhoneControl({ ...input, action: "hangup" });
}

export function air780CallLinkOutboundRequestHash(
  record: CallLinkRecord,
  request: CreatePhoneOutboundCallRequest,
) {
  const secret = process.env.INTERNAL_API_SECRET ?? "";
  return createHmac("sha256", secret).update(JSON.stringify({
    sessionId: record.sessionId,
    targetPhone: request.targetPhone,
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    disclosureConfirmed: request.disclosureConfirmed,
    initialDtmf: request.initialDtmf,
  })).digest("hex");
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
