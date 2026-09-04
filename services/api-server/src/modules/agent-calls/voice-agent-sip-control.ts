import { createHash } from "node:crypto";
import type { CallLinkRecord } from "../call-links/call-links.service.js";
import { liveKitSipParticipantIdentity } from
  "../call-links/livekit-sip-identity.js";
import { LiveKitSipProviderAdapter } from
  "../call-links/livekit-sip-provider-adapter.js";
import type { LiveKitSipConfig } from
  "../call-links/livekit-sip-readiness.js";
import {
  beginProviderOperation,
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { findAgentDialProviderOperation } from
  "./agent-call-provider-operation.js";

export async function executeVoiceAgentHangup(input: {
  call: CallLinkRecord;
  config: LiveKitSipConfig;
  idempotencyKey: string;
  providerOperationId: string;
}) {
  const dial = await findAgentDialProviderOperation(
    input.call.sessionId,
    input.providerOperationId,
  );
  if (!dial || dial.provider !== "livekit_sip" ||
    !["accepted", "unknown", "active", "succeeded"]
    .includes(dial.status)) {
    return { ok: false as const, code: "sip_not_started" };
  }
  const requestHash = createHash("sha256").update(JSON.stringify({
    callId: input.call.callId,
    roomName: input.call.roomName,
    dialOperationId: dial.id,
  })).digest("hex");
  const started = await beginProviderOperation({
    sessionId: input.call.sessionId,
    provider: "livekit_sip",
    operationType: "sip_hangup",
    operationKey: "voice-agent-runtime",
    idempotencyKey: input.idempotencyKey,
    requestHash,
  });
  if (started.status === "payload_conflict" ||
    started.status === "session_conflict") {
    return { ok: false as const, code: "hangup_operation_conflict" };
  }
  if (["succeeded", "failed", "cancelled"].includes(started.operation.status)) {
    return {
      ok: started.operation.status === "succeeded",
      code: started.operation.status,
      operation: started.operation,
      replayed: true,
    } as const;
  }
  const participantIdentity = liveKitSipParticipantIdentity(
    input.call.sessionId,
    dial.id,
  );
  const result = await new LiveKitSipProviderAdapter(input.config)
    .removeParticipant({
      operationId: started.operation.id,
      sessionId: input.call.sessionId,
      expectedVersion: started.operation.version,
      idempotencyKey: started.operation.idempotencyKey,
      deadlineAt: new Date(
        Date.now() + input.config.requestTimeoutSeconds * 1000,
      ).toISOString(),
      payload: { roomName: input.call.roomName, participantIdentity },
    });
  const notFound = !result.ok && result.errorClass === "not_found";
  const status = result.ok || notFound
    ? "succeeded"
    : result.reconciliationRequired ? "unknown" : "failed";
  await updateProviderOperation({
    operationId: started.operation.id,
    status,
    errorClass: result.ok ? undefined : result.errorClass,
    ...(result.ok && result.externalResourceId
      ? { externalResourceId: result.externalResourceId }
      : {}),
  });
  const operation = await findProviderOperation(started.operation.id) ?? started.operation;
  return {
    ok: status === "succeeded",
    code: status,
    operation,
    replayed: started.status === "replayed",
  } as const;
}
