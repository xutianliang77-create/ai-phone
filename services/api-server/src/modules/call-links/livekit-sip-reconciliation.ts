import {
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import type { ProviderOperationRecord } from "../provider-operations/provider-operation-record.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { endCallLegs } from "../sessions/sessions-runtime.repository.js";
import { registerCallLeg } from "./call-links.service.js";
import { updateAgentCallFromPstnWebhook } from
  "../agent-calls/agent-calls.repository.js";

export async function markLiveKitSipAnswered(input: {
  operationId: string;
  participantIdentity: string;
  observedAt: Date;
  externalOperationId?: string;
  externalResourceId?: string;
}) {
  const updated = updateProviderOperation({
    operationId: input.operationId,
    status: "active",
    externalOperationId: input.externalOperationId,
    externalResourceId: input.externalResourceId,
    now: input.observedAt,
  });
  if (updated.status !== "updated") {
    return { status: updated.status, terminal: false };
  }
  await registerCallLeg({
    callId: updated.operation.sessionId,
    participantIdentity: input.participantIdentity,
    participantRole: "guest",
    joinType: "sip",
    joinedAt: updated.operation.answeredAt,
  });
  if (!updated.operation.completionObservedAt) {
    return { status: "active" as const, terminal: false };
  }
  return finishSipOperation(
    updated.operation,
    "succeeded",
    new Date(updated.operation.completionObservedAt),
    updated.operation.completionObservedEvent ?? "participant_left",
  );
}

export async function observeLiveKitSipCompletion(input: {
  operationId: string;
  event: "participant_left" | "participant_connection_aborted";
  observedAt: Date;
  externalOperationId?: string;
  externalResourceId?: string;
}) {
  const operation = findProviderOperation(input.operationId);
  if (!operation) return { status: "ignored" as const, terminal: false };
  if (input.event === "participant_left" && !operation.answeredAt) {
    const pending = updateProviderOperation({
      operationId: operation.id,
      status: "unknown",
      externalOperationId: input.externalOperationId,
      externalResourceId: input.externalResourceId,
      completionObservedAt: input.observedAt.toISOString(),
      completionObservedEvent: input.event,
      now: input.observedAt,
    });
    return {
      status: pending.status === "updated"
        ? "pending_reconciliation" as const
        : pending.status,
      terminal: false,
    };
  }
  return finishSipOperation(
    operation,
    input.event === "participant_left" ? "succeeded" : "failed",
    input.observedAt,
    input.event,
  );
}

export async function expirePendingLiveKitSipCompletion(
  operationId: string,
) {
  const operation = findProviderOperation(operationId);
  if (!operation || operation.status !== "unknown" || operation.answeredAt ||
    !operation.completionObservedAt) {
    return { status: "ignored" as const, terminal: false };
  }
  return finishSipOperation(
    operation,
    "failed",
    new Date(operation.completionObservedAt),
    operation.completionObservedEvent ?? "reconciliation_grace_expired",
  );
}

async function finishSipOperation(
  operation: ProviderOperationRecord,
  terminalStatus: "succeeded" | "failed",
  endedAt: Date,
  terminalEvent: string,
) {
  const billableSeconds = operation.answeredAt
    ? Math.max(0, Math.ceil(
        (endedAt.getTime() - Date.parse(operation.answeredAt)) / 1000,
      ))
    : 0;
  const session = await completeSessionWithUsage(operation.sessionId, {
    billableSeconds,
  });
  if (!session) throw new Error("SIP completion session was not found");
  if (session?.endedAt) await endCallLegs(session.id, session.endedAt);
  const updated = updateProviderOperation({
    operationId: operation.id,
    status: terminalStatus,
    errorClass: terminalStatus === "failed" ? "call_not_answered" : undefined,
    completionObservedAt: endedAt.toISOString(),
    completionObservedEvent: terminalEvent,
    now: endedAt,
  });
  if (updated.status === "terminal") {
    return { status: updated.operation.status, terminal: true, billableSeconds };
  }
  if (updated.status !== "updated") {
    throw new Error(`SIP terminal operation update failed: ${updated.status}`);
  }
  updateAgentCallFromPstnWebhook({
    eventId: "livekit-terminal:" + updated.operation.id + ":" +
      (updated.operation.completionObservedAt ?? endedAt.toISOString()),
    callId: updated.operation.sessionId,
    status: terminalStatus === "succeeded" ? "completed" : "failed",
    providerOperationStatus: terminalStatus,
    providerCallId: updated.operation.externalOperationId,
    consumedSeconds: billableSeconds,
    ...(terminalStatus === "failed"
      ? { failureReason: updated.operation.lastErrorClass ?? "call_not_answered" }
      : {}),
  });
  return { status: terminalStatus, terminal: true, billableSeconds };
}
