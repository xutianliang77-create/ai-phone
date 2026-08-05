import { createHash } from "node:crypto";
import type { CallLinkRecord } from "../call-links/call-links.service.js";
import { getLiveKitSipConfig } from "../call-links/livekit-sip-readiness.js";
import {
  beginProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import { getAgentCallTelephonyRuntime } from
  "./agent-call-telephony-runtime.js";
import { findAgentDialProviderOperation } from
  "./agent-call-provider-operation.js";
import { executePhoneControl } from "./phone-control-coordinator.js";
import { executeVoiceAgentHangup } from "./voice-agent-sip-control.js";

export async function executeVoiceAgentPhoneHangup(input: {
  call: CallLinkRecord;
  idempotencyKey: string;
  providerOperationId: string;
}) {
  const dial = await activeDial(
    input.call.sessionId,
    input.providerOperationId,
  );
  if (!dial) return { ok: false as const, code: "phone_not_started" };
  if (dial.provider === "livekit_sip") {
    const sip = getLiveKitSipConfig();
    return sip.ok
      ? executeVoiceAgentHangup({ ...input, config: sip.config })
      : { ok: false as const, code: "phone_runtime_not_ready" };
  }
  return executeAirControl({
    call: input.call,
    dial,
    action: "hangup",
    operationKey: "voice-agent-runtime",
    idempotencyKey: input.idempotencyKey,
  });
}

export async function executeVoiceAgentPhoneDtmf(input: {
  call: CallLinkRecord;
  digit: string;
  operationKey: string;
  idempotencyKey: string;
  providerOperationId: string;
}) {
  const dial = await activeDial(
    input.call.sessionId,
    input.providerOperationId,
  );
  if (!dial || dial.provider !== "air780_volte") {
    return { ok: false as const, code: "phone_not_started" };
  }
  return executeAirControl({
    call: input.call,
    dial,
    action: "dtmf",
    digit: input.digit,
    operationKey: input.operationKey,
    idempotencyKey: input.idempotencyKey,
  });
}

async function executeAirControl(input: {
  call: CallLinkRecord;
  dial: ProviderOperationRecord;
  action: "hangup" | "dtmf";
  digit?: string;
  operationKey: string;
  idempotencyKey: string;
}) {
  const telephony = getAgentCallTelephonyRuntime("air780_volte");
  if (!telephony.ok) {
    return { ok: false as const, code: "phone_runtime_not_ready" };
  }
  let payload;
  try {
    payload = await telephony.runtime.resolveControlPayload({
      call: input.call,
      operation: input.dial,
      action: input.action,
    });
  } catch {
    return { ok: false as const, code: "phone_binding_not_ready" };
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    callId: input.call.callId,
    dialOperationId: input.dial.id,
    providerCallId: payload.providerCallId,
    callGeneration: payload.callGeneration,
    action: input.action,
    ...(input.digit ? { digit: input.digit } : {}),
  })).digest("hex");
  const started = await beginProviderOperation({
    sessionId: input.call.sessionId,
    provider: "air780_volte",
    operationType: input.action === "dtmf" ? "phone_dtmf" : "phone_hangup",
    operationKey: input.operationKey,
    idempotencyKey: input.idempotencyKey,
    requestHash,
  });
  if (started.status === "payload_conflict" ||
    started.status === "session_conflict") {
    return { ok: false as const, code: "phone_operation_conflict" };
  }
  const result = input.action === "dtmf"
    ? await executePhoneControl({
        action: "dtmf",
        operation: started.operation,
        provider: telephony.runtime.adapter,
        payload: { ...payload, digits: input.digit! },
        timeoutMs: telephony.runtime.timeoutMs,
      })
    : await executePhoneControl({
        action: "hangup",
        operation: started.operation,
        provider: telephony.runtime.adapter,
        payload,
        timeoutMs: telephony.runtime.timeoutMs,
      });
  return result.ok
    ? {
        ok: true as const,
        code: result.operation.status,
        operation: result.operation,
        replayed: started.status === "replayed" || result.replayed,
      }
    : {
        ok: false as const,
        code: result.operation.status,
        operation: result.operation,
        reconciliationRequired: result.reconciliationRequired,
        errorClass: result.errorClass,
        replayed: started.status === "replayed",
      };
}

async function activeDial(sessionId: string, providerOperationId: string) {
  const dial = await findAgentDialProviderOperation(
    sessionId,
    providerOperationId,
  );
  if (!dial || (dial.provider !== "air780_volte" &&
    dial.provider !== "livekit_sip") ||
    !["accepted", "active", "succeeded", "unknown"].includes(dial.status)) {
    return null;
  }
  return dial;
}
