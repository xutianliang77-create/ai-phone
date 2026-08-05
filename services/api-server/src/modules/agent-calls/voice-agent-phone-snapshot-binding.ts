import type { CallLinkRecord } from "../call-links/call-links.service.js";
import { findProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import { getAgentCallTelephonyRuntime } from
  "./agent-call-telephony-runtime.js";
import { isAgentCallDialOperation } from "./agent-call-provider-profile.js";

export async function resolveVoiceAgentPhoneSnapshotBinding(input: {
  call: CallLinkRecord;
  providerOperationId: string;
}) {
  const operation = await findProviderOperation(input.providerOperationId);
  if (!operation || operation.sessionId !== input.call.sessionId ||
    !isAgentCallDialOperation(operation) ||
    (operation.provider !== "air780_volte" &&
      operation.provider !== "livekit_sip")) {
    return { ok: false as const, statusCode: 409, code: "binding_missing" };
  }
  const telephony = getAgentCallTelephonyRuntime(operation.provider);
  if (!telephony.ok) {
    return { ok: false as const, statusCode: 503, code: "runtime_not_ready" };
  }
  try {
    const binding = await telephony.runtime.resolveParticipantBinding({
      call: input.call,
      operation,
    });
    return { ok: true as const, operation, binding };
  } catch {
    return { ok: false as const, statusCode: 503, code: "binding_not_ready" };
  }
}
