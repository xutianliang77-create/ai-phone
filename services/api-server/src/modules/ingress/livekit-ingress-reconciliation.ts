import type { WebhookEvent } from "livekit-server-sdk";
import type { ExternalMediaProviderJob } from "@translation/contracts";
import { processInboxEventOnly } from "../events/reliable-events.repository.js";
import {
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { toIngressProviderJob } from "./livekit-ingress-provider-adapter.js";
import {
  findExternalMediaSourceByIngressId,
  updateExternalMediaSource,
} from "./ingress.repository.js";

export function reconcileLiveKitIngressWebhook(event: WebhookEvent) {
  if (!event.id || !event.ingressInfo ||
    !["ingress_started", "ingress_ended"].includes(event.event)) return null;
  const providerJob = toIngressProviderJob(event.ingressInfo);
  const source = findExternalMediaSourceByIngressId(providerJob.ingressId);
  if (!source || source.roomName !== providerJob.roomName ||
    source.participantIdentity !== providerJob.participantIdentity) return null;
  const processed = processInboxEventOnly({
    eventId: `livekit:${event.id}`,
    sessionId: source.sessionId,
    eventType: `livekit.${event.event}`,
    payload: {
      id: event.id,
      event: event.event,
      createdAt: event.createdAt.toString(),
      ingressId: providerJob.ingressId,
      roomName: providerJob.roomName,
      participantIdentity: providerJob.participantIdentity,
      status: providerJob.status,
    },
    process: () => applyIngressProviderJob(source.id, providerJob),
  });
  return {
    duplicate: processed.duplicate,
    eventId: event.id,
    sourceId: source.id,
    status: processed.result?.status ?? source.status,
  };
}

export function applyIngressProviderJob(
  sourceId: string,
  providerJob: ExternalMediaProviderJob,
) {
  const source = findExternalMediaSourceByIngressId(providerJob.ingressId);
  if (!source || source.id !== sourceId) return null;
  const status = providerJob.status === "publishing"
    ? "publishing" as const
    : providerJob.status === "buffering"
    ? "buffering" as const
    : providerJob.status === "complete"
    ? "completed" as const
    : providerJob.status === "failed"
    ? "failed" as const
    : "ready" as const;
  const result = updateExternalMediaSource({
    sourceId,
    status,
    errorClass: providerJob.error,
  });
  if (source.providerOperationId) {
    updateProviderOperation({
      operationId: source.providerOperationId,
      status: status === "failed" ? "failed"
        : status === "publishing" ? "active"
        : status === "completed" ? "succeeded" : "accepted",
      errorClass: providerJob.error,
    });
  }
  const deleteOperation = findSessionProviderOperation(
    source.sessionId,
    "ingress_delete",
    source.id,
  );
  if (deleteOperation && ["completed", "failed"].includes(status)) {
    updateProviderOperation({
      operationId: deleteOperation.id,
      status: status === "completed" ? "succeeded" : "failed",
      errorClass: providerJob.error,
    });
  }
  return result.status === "updated" ? result.source : source;
}
