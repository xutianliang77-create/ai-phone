import type { FastifyInstance } from "fastify";
import { WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  InboxPayloadConflictError,
  processInboxEventOnlyAsync,
} from "../events/reliable-events.repository.js";
import {
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  findCallLink,
} from "./call-links.service.js";
import { deliverPendingCallRoomDataEvents } from "./call-room-worker.js";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";
import { liveKitSipParticipantIdentity } from "./livekit-sip-identity.js";
import {
  markLiveKitSipAnswered,
  observeLiveKitSipCompletion,
} from "./livekit-sip-reconciliation.js";
import { reconcileLiveKitEgressWebhook } from "../recordings/livekit-egress-reconciliation.js";
import { reconcileLiveKitIngressWebhook } from "../ingress/livekit-ingress-reconciliation.js";
import { closeLiveKitSipInbound } from "./call-link-sip-inbound.routes.js";
import {
  findAgentToolExecutionByProviderOperation,
  updateAgentToolExecution,
} from "../agent-calls/agent-orchestration.repository.js";
import { getVoiceAgentRuntimeSupervisor } from
  "../agent-calls/voice-agent-runtime-supervisor.js";
import {
  AgentConsultWebhookBindingError,
  reconcileAgentConsultWebhook,
} from "../agent-calls/agent-consult-webhook.js";

export function registerLiveKitSipWebhookRoutes(app: FastifyInstance) {
  if (!app.hasContentTypeParser("application/webhook+json")) {
    app.addContentTypeParser(
      "application/webhook+json",
      { parseAs: "string" },
      (_request, body, done) => done(null, body),
    );
  }
  app.post("/webhooks/livekit", async (request, reply) => {
    const config = getLiveKitRoomConfig();
    if (!config.ok) {
      return sendError(
        reply,
        503,
        "livekit_webhook_not_configured",
        "LiveKit webhook is not configured",
      );
    }
    if (typeof request.body !== "string") {
      return sendError(
        reply,
        415,
        "invalid_livekit_webhook_content_type",
        "LiveKit webhook requires application/webhook+json",
      );
    }
    let event: WebhookEvent;
    try {
      event = await new WebhookReceiver(
        config.config.apiKey,
        config.config.apiSecret,
      ).receive(request.body, singleHeader(request.headers.authorization));
    } catch {
      return sendError(
        reply,
        401,
        "invalid_livekit_webhook_signature",
        "Invalid LiveKit webhook signature",
      );
    }
    try {
      const egress = reconcileLiveKitEgressWebhook(event);
      if (egress) {
        return reply.status(202).send({
          status: egress.duplicate ? "duplicate" : egress.status,
          eventId: egress.eventId,
          recordingId: egress.recordingId,
        });
      }
      const ingress = reconcileLiveKitIngressWebhook(event);
      if (ingress) {
        return reply.status(202).send({
          status: ingress.duplicate ? "duplicate" : ingress.status,
          eventId: ingress.eventId,
          sourceId: ingress.sourceId,
        });
      }
    } catch (error) {
      if (error instanceof InboxPayloadConflictError) {
        return sendError(
          reply,
          409,
          "livekit_webhook_payload_conflict",
          "LiveKit webhook payload conflicts with a processed event",
        );
      }
      request.log.error({ eventId: event.id, err: error }, "Egress webhook failed");
      return sendError(reply, 409, "livekit_egress_binding_conflict", "Egress event conflict");
    }
    try {
      const consult = reconcileAgentConsultWebhook(event);
      if (consult) {
        return reply.status(202).send({
          status: consult.status,
          eventId: consult.eventId,
          operationId: consult.operationId,
          consultId: consult.consultId,
        });
      }
    } catch (error) {
      if (error instanceof InboxPayloadConflictError) {
        return sendError(
          reply,
          409,
          "livekit_webhook_payload_conflict",
          "LiveKit webhook payload conflicts with a processed event",
        );
      }
      if (error instanceof AgentConsultWebhookBindingError) {
        return sendError(
          reply,
          409,
          "agent_consult_webhook_binding_conflict",
          "Operator consult webhook binding does not match an active consult",
        );
      }
      request.log.error({ eventId: event.id, err: error }, "Consult webhook failed");
      return sendError(reply, 409, "agent_consult_webhook_failed", "Consult event failed");
    }
    const binding = await sipEventBinding(event);
    if (!binding) return reply.status(202).send({ status: "ignored", eventId: event.id });
    const operation = findProviderOperation(binding.operationId);
    if (!operation || operation.provider !== "livekit_sip" ||
      operation.operationType !== binding.operationType ||
      operation.sessionId !== binding.sessionId) {
      return sendError(
        reply,
        409,
        "livekit_sip_webhook_binding_conflict",
        "LiveKit SIP webhook binding does not match an operation",
      );
    }

    let processed;
    try {
      processed = await processInboxEventOnlyAsync({
        eventId: `livekit:${event.id}`,
        sessionId: operation.sessionId,
        eventType: `livekit.${event.event}`,
        payload: safeEventPayload(event),
        process: () => applySipEvent(event, operation.id),
      });
    } catch (error) {
      if (error instanceof InboxPayloadConflictError) {
        request.log.error(
          { eventId: event.id, operationId: operation.id },
          "LiveKit webhook event id was reused with a different payload",
        );
        return sendError(
          reply,
          409,
          "livekit_webhook_payload_conflict",
          "LiveKit webhook payload conflicts with a processed event",
        );
      }
      throw error;
    }
    if (processed.duplicate) {
      return { status: "duplicate", eventId: event.id, operationId: operation.id };
    }

    const result = processed.result;
    if (result?.terminal) {
      if (operation.operationType === "sip_inbound") {
        await closeLiveKitSipInbound(
          findProviderOperation(operation.id) ?? operation,
          "call_terminal",
        );
      }
      const record = await findCallLink(operation.sessionId);
      if (record?.purpose === "voice_agent") {
        await getVoiceAgentRuntimeSupervisor().stop(operation.sessionId);
      } else {
        await getCallLinkWorkerSupervisor().stop(operation.sessionId);
      }
      if (record) await deliverPendingCallRoomDataEvents(record);
    }
    return {
      status: result?.status ?? "ignored",
      eventId: event.id,
      operationId: operation.id,
    };
  });
}

async function applySipEvent(event: WebhookEvent, operationId: string) {
  const operation = findProviderOperation(operationId);
  if (!operation) return { status: "ignored" as const, terminal: false };
  const externalOperationId = event.participant?.attributes?.["sip.callID"];
  const externalResourceId = operation.operationType === "sip_outbound"
    ? event.participant?.sid || undefined
    : undefined;
  if (event.event === "participant_joined") {
    const callStatus = event.participant?.attributes?.["sip.callStatus"];
    if (callStatus === "active" || callStatus === "automation") {
      return await markLiveKitSipAnswered({
        operationId,
        participantIdentity: event.participant!.identity,
        observedAt: eventDate(event),
        externalOperationId,
        externalResourceId,
      });
    }
    const observed = updateProviderOperation({
      operationId,
      status: operation.status,
      externalOperationId,
      externalResourceId,
      now: eventDate(event),
    });
    return {
      status: observed.status === "updated" ? "dialing" as const : observed.status,
      terminal: false,
    };
  }
  if (event.event !== "participant_left" &&
    event.event !== "participant_connection_aborted") {
    return { status: "ignored" as const, terminal: false };
  }

  const result = await observeLiveKitSipCompletion({
    operationId,
    event: event.event,
    observedAt: eventDate(event),
    externalOperationId,
    externalResourceId,
  });
  if (result.terminal) reconcileHangupOperation(operation.sessionId, eventDate(event));
  return result;
}

async function sipEventBinding(event: WebhookEvent) {
  if (!event.id || !event.participant || !event.room?.name) return null;
  if (!["participant_joined", "participant_left", "participant_connection_aborted"]
    .includes(event.event)) return null;
  const attributes = event.participant.attributes;
  const operationId = attributes["translation.operationId"];
  const sessionId = attributes["translation.sessionId"];
  if (!operationId || !sessionId || attributes["translation.role"] !== "guest") return null;
  const record = await findCallLink(sessionId);
  if (!record || record.roomName !== event.room.name) return null;
  const inbound = attributes["translation.direction"] === "inbound";
  if (!inbound && event.participant.identity !== liveKitSipParticipantIdentity(
      sessionId,
      operationId,
    )) return null;
  return {
    operationId,
    sessionId,
    operationType: inbound ? "sip_inbound" as const : "sip_outbound" as const,
  };
}

function safeEventPayload(event: WebhookEvent) {
  return {
    id: event.id,
    event: event.event,
    createdAt: event.createdAt.toString(),
    roomName: event.room?.name,
    participantSid: event.participant?.sid,
    participantIdentity: event.participant?.identity,
    participantAttributes: safeParticipantAttributes(event),
    disconnectReason: event.participant?.disconnectReason,
  };
}

function safeParticipantAttributes(event: WebhookEvent) {
  const attributes = event.participant?.attributes ?? {};
  return Object.fromEntries([
    "translation.operationId",
    "translation.sessionId",
    "translation.role",
    "translation.direction",
    "sip.callID",
    "sip.callStatus",
  ].flatMap((key) => attributes[key] ? [[key, attributes[key]]] : []));
}

function reconcileHangupOperation(sessionId: string, observedAt: Date) {
  const hangup = findSessionProviderOperation(sessionId, "sip_hangup");
  if (!hangup || ["succeeded", "failed", "cancelled"].includes(hangup.status)) return;
  const updated = updateProviderOperation({
    operationId: hangup.id,
    status: "succeeded",
    completionObservedAt: observedAt.toISOString(),
    completionObservedEvent: "participant_left",
    now: observedAt,
  });
  const operation = "operation" in updated && updated.operation
    ? updated.operation
    : hangup;
  const execution = findAgentToolExecutionByProviderOperation(operation.id);
  if (execution) {
    updateAgentToolExecution({
      executionId: execution.id,
      status: "succeeded",
      resultSummary: "SIP hangup confirmed by participant_left",
      now: observedAt,
    });
  }
}

function eventDate(event: WebhookEvent) {
  const milliseconds = Number(event.createdAt) * 1000;
  return new Date(Number.isFinite(milliseconds) ? milliseconds : Date.now());
}

function singleHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
