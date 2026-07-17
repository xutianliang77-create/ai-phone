import type { WebhookEvent } from "livekit-server-sdk";
import {
  processInboxEventOnly,
} from "../events/reliable-events.repository.js";
import {
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import {
  findAgentConsult,
  updateAgentConsult,
} from "./agent-consult.repository.js";

export class AgentConsultWebhookBindingError extends Error {}

export function reconcileAgentConsultWebhook(event: WebhookEvent) {
  const role = event.participant?.attributes?.["translation.role"];
  if (role !== "operator") return null;
  const binding = bindingFor(event);
  const processed = processInboxEventOnly({
    eventId: `livekit:${event.id}`,
    sessionId: binding.consult.sessionId,
    eventType: `livekit.${event.event}`,
    payload: safePayload(event),
    process: () => applyEvent(event, binding.consult.id),
  });
  return {
    duplicate: processed.duplicate,
    eventId: event.id,
    operationId: binding.operation.id,
    consultId: binding.consult.id,
    status: processed.duplicate ? "duplicate" : processed.result.status,
  };
}

function bindingFor(event: WebhookEvent) {
  if (!event.id || !event.participant || !event.room?.name ||
    !["participant_joined", "participant_left", "participant_connection_aborted"]
      .includes(event.event)) {
    throw new AgentConsultWebhookBindingError("Invalid operator webhook event");
  }
  const attributes = event.participant.attributes;
  const consultId = attributes["translation.consultId"];
  const operationId = attributes["translation.operationId"];
  const sessionId = attributes["translation.sessionId"];
  const consult = consultId ? findAgentConsult(consultId) : null;
  const operation = operationId ? findProviderOperation(operationId) : null;
  if (!consult || !operation || operation.provider !== "livekit_sip" ||
    operation.operationType !== "sip_consult" || operation.sessionId !== sessionId ||
    consult.providerOperationId !== operation.id || consult.sessionId !== sessionId ||
    consult.operatorParticipantIdentity !== event.participant.identity ||
    ![consult.consultRoomName, consult.mainRoomName].includes(event.room.name)) {
    throw new AgentConsultWebhookBindingError("Operator webhook binding mismatch");
  }
  return { consult, operation };
}

function applyEvent(event: WebhookEvent, consultId: string) {
  const consult = findAgentConsult(consultId)!;
  const operation = findProviderOperation(consult.providerOperationId!)!;
  const observedAt = eventDate(event);
  const roomName = event.room!.name;
  const mainRoom = roomName === consult.mainRoomName;
  const externalOperationId = event.participant?.attributes?.["sip.callID"];
  const externalResourceId = event.participant?.sid || undefined;
  if (event.event === "participant_joined") {
    updateOperationActive(operation.id, observedAt, externalOperationId, externalResourceId);
    if (!mainRoom && answered(event)) advanceConnected(consultId, observedAt);
    if (mainRoom) {
      finishMoveOperation(consult.sessionId, consult.id, observedAt);
      if (consult.status === "connected") {
        updateAgentConsult({ consultId, status: "merging", now: observedAt });
      }
      if (["connected", "merging"].includes(findAgentConsult(consultId)!.status)) {
        updateAgentConsult({ consultId, status: "merged", now: observedAt });
      }
    }
    return { status: mainRoom ? "merged" as const :
      answered(event) ? "connected" as const : "dialing" as const };
  }
  if (!mainRoom && ["merging", "merged"].includes(consult.status)) {
    return { status: "moving" as const };
  }
  finishLegOperation(
    operation.id,
    consult.connectedAt ? "succeeded" : "failed",
    observedAt,
    event.event,
    externalOperationId,
    externalResourceId,
  );
  if (["rejected", "no_answer", "failed", "completed"].includes(consult.status)) {
    return { status: consult.status };
  }
  if (!consult.connectedAt && !mainRoom) {
    if (consult.status === "requested") {
      updateAgentConsult({ consultId, status: "dialing", now: observedAt });
    }
    updateAgentConsult({
      consultId,
      status: "no_answer",
      failureCode: "operator_no_answer",
      now: observedAt,
    });
    return { status: "no_answer" as const };
  }
  updateAgentConsult({
    consultId,
    status: "failed",
    failureCode: mainRoom ? "operator_left_after_merge" : "operator_left_consult",
    now: observedAt,
  });
  return { status: "failed" as const };
}

function advanceConnected(consultId: string, now: Date) {
  const consult = findAgentConsult(consultId)!;
  if (consult.status === "requested") {
    updateAgentConsult({ consultId, status: "dialing", now });
  }
  if (["requested", "dialing"].includes(findAgentConsult(consultId)!.status)) {
    updateAgentConsult({ consultId, status: "connected", now });
  }
}

function updateOperationActive(
  operationId: string,
  now: Date,
  externalOperationId?: string,
  externalResourceId?: string,
) {
  const operation = findProviderOperation(operationId);
  if (!operation || ["active", "succeeded", "failed", "cancelled"].includes(operation.status)) {
    return;
  }
  updateProviderOperation({
    operationId,
    status: "active",
    externalOperationId,
    externalResourceId,
    now,
  });
}

function finishMoveOperation(sessionId: string, consultId: string, now: Date) {
  const move = findSessionProviderOperation(sessionId, "sip_consult_move", consultId);
  if (move && !["succeeded", "failed", "cancelled"].includes(move.status)) {
    updateProviderOperation({ operationId: move.id, status: "succeeded", now });
  }
}

function finishLegOperation(
  operationId: string,
  status: "succeeded" | "failed",
  now: Date,
  event: string,
  externalOperationId?: string,
  externalResourceId?: string,
) {
  const operation = findProviderOperation(operationId);
  if (!operation || ["succeeded", "failed", "cancelled"].includes(operation.status)) return;
  updateProviderOperation({
    operationId,
    status,
    externalOperationId,
    externalResourceId,
    completionObservedAt: now.toISOString(),
    completionObservedEvent: event,
    now,
  });
}

function answered(event: WebhookEvent) {
  const status = event.participant?.attributes?.["sip.callStatus"];
  return status === "active" || status === "automation";
}

function safePayload(event: WebhookEvent) {
  const attributes = event.participant?.attributes ?? {};
  return {
    id: event.id,
    event: event.event,
    createdAt: event.createdAt.toString(),
    roomName: event.room?.name,
    participantSid: event.participant?.sid,
    participantIdentity: event.participant?.identity,
    participantAttributes: Object.fromEntries([
      "translation.operationId",
      "translation.sessionId",
      "translation.consultId",
      "translation.role",
      "sip.callID",
      "sip.callStatus",
    ].flatMap((key) => attributes[key] ? [[key, attributes[key]]] : [])),
    disconnectReason: event.participant?.disconnectReason,
  };
}

function eventDate(event: WebhookEvent) {
  const milliseconds = Number(event.createdAt) * 1000;
  return new Date(Number.isFinite(milliseconds) ? milliseconds : Date.now());
}
