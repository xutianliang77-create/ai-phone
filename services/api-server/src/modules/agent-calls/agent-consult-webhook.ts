import type { WebhookEvent } from "livekit-server-sdk";
import {
  processInboxEventOnlyAsync,
} from "../events/reliable-events-runtime.repository.js";
import {
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import {
  findAgentConsult,
  updateAgentConsult,
} from "./agent-consult-runtime.repository.js";

export class AgentConsultWebhookBindingError extends Error {}

export async function reconcileAgentConsultWebhook(event: WebhookEvent) {
  const role = event.participant?.attributes?.["translation.role"];
  if (role !== "operator") return null;
  const binding = await bindingFor(event);
  const processed = await processInboxEventOnlyAsync({
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

async function bindingFor(event: WebhookEvent) {
  if (!event.id || !event.participant || !event.room?.name ||
    !["participant_joined", "participant_left", "participant_connection_aborted"]
      .includes(event.event)) {
    throw new AgentConsultWebhookBindingError("Invalid operator webhook event");
  }
  const attributes = event.participant.attributes;
  const consultId = attributes["translation.consultId"];
  const operationId = attributes["translation.operationId"];
  const sessionId = attributes["translation.sessionId"];
  const consult = consultId ? await findAgentConsult(consultId) : null;
  const operation = operationId ? await findProviderOperation(operationId) : null;
  if (!consult || !operation || operation.provider !== "livekit_sip" ||
    operation.operationType !== "sip_consult" || operation.sessionId !== sessionId ||
    consult.providerOperationId !== operation.id || consult.sessionId !== sessionId ||
    consult.operatorParticipantIdentity !== event.participant.identity ||
    ![consult.consultRoomName, consult.mainRoomName].includes(event.room.name)) {
    throw new AgentConsultWebhookBindingError("Operator webhook binding mismatch");
  }
  return { consult, operation };
}

async function applyEvent(event: WebhookEvent, consultId: string) {
  const consult = (await findAgentConsult(consultId))!;
  const operation = (await findProviderOperation(consult.providerOperationId!))!;
  const observedAt = eventDate(event);
  const roomName = event.room!.name;
  const mainRoom = roomName === consult.mainRoomName;
  const externalOperationId = event.participant?.attributes?.["sip.callID"];
  const externalResourceId = event.participant?.sid || undefined;
  if (event.event === "participant_joined") {
    await updateOperationActive(
      operation.id,
      observedAt,
      externalOperationId,
      externalResourceId,
    );
    if (!mainRoom && answered(event)) await advanceConnected(consultId, observedAt);
    if (mainRoom) {
      await finishMoveOperation(consult.sessionId, consult.id, observedAt);
      if (consult.status === "connected") {
        await updateAgentConsult({ consultId, status: "merging", now: observedAt });
      }
      const current = await findAgentConsult(consultId);
      if (current && ["connected", "merging"].includes(current.status)) {
        await updateAgentConsult({ consultId, status: "merged", now: observedAt });
      }
    }
    return { status: mainRoom ? "merged" as const :
      answered(event) ? "connected" as const : "dialing" as const };
  }
  if (!mainRoom && ["merging", "merged"].includes(consult.status)) {
    return { status: "moving" as const };
  }
  await finishLegOperation(
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
      await updateAgentConsult({ consultId, status: "dialing", now: observedAt });
    }
    await updateAgentConsult({
      consultId,
      status: "no_answer",
      failureCode: "operator_no_answer",
      now: observedAt,
    });
    return { status: "no_answer" as const };
  }
  await updateAgentConsult({
    consultId,
    status: "failed",
    failureCode: mainRoom ? "operator_left_after_merge" : "operator_left_consult",
    now: observedAt,
  });
  return { status: "failed" as const };
}

async function advanceConnected(consultId: string, now: Date) {
  const consult = (await findAgentConsult(consultId))!;
  if (consult.status === "requested") {
    await updateAgentConsult({ consultId, status: "dialing", now });
  }
  const current = await findAgentConsult(consultId);
  if (current && ["requested", "dialing"].includes(current.status)) {
    await updateAgentConsult({ consultId, status: "connected", now });
  }
}

async function updateOperationActive(
  operationId: string,
  now: Date,
  externalOperationId?: string,
  externalResourceId?: string,
) {
  const operation = await findProviderOperation(operationId);
  if (!operation || ["active", "succeeded", "failed", "cancelled"].includes(operation.status)) {
    return;
  }
  await updateProviderOperation({
    operationId,
    status: "active",
    externalOperationId,
    externalResourceId,
    now,
  });
}

async function finishMoveOperation(sessionId: string, consultId: string, now: Date) {
  const move = await findSessionProviderOperation(sessionId, "sip_consult_move", consultId);
  if (move && !["succeeded", "failed", "cancelled"].includes(move.status)) {
    await updateProviderOperation({ operationId: move.id, status: "succeeded", now });
  }
}

async function finishLegOperation(
  operationId: string,
  status: "succeeded" | "failed",
  now: Date,
  event: string,
  externalOperationId?: string,
  externalResourceId?: string,
) {
  const operation = await findProviderOperation(operationId);
  if (!operation || ["succeeded", "failed", "cancelled"].includes(operation.status)) return;
  await updateProviderOperation({
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
