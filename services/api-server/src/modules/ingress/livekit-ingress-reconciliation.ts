import type { WebhookEvent } from "livekit-server-sdk";
import type { ExternalMediaProviderJob } from "@translation/contracts";
import { processInboxEventOnlyAsync } from
  "../events/reliable-events-runtime.repository.js";
import {
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { toIngressProviderJob } from "./livekit-ingress-provider-adapter.js";
import {
  findExternalMediaSourceByIngressId,
  updateExternalMediaSource,
} from "./ingress-runtime.repository.js";

export async function reconcileLiveKitIngressWebhook(event: WebhookEvent) {
  if (!event.id || !event.ingressInfo ||
    !["ingress_started", "ingress_ended"].includes(event.event)) return null;
  const providerJob = toIngressProviderJob(event.ingressInfo);
  const source = await findExternalMediaSourceByIngressId(providerJob.ingressId);
  if (!source || source.roomName !== providerJob.roomName ||
    source.participantIdentity !== providerJob.participantIdentity) return null;
  const processed = await processInboxEventOnlyAsync({
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

export async function applyIngressProviderJob(
  sourceId: string,
  providerJob: ExternalMediaProviderJob,
) {
  const source = await findExternalMediaSourceByIngressId(providerJob.ingressId);
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
  const result = await updateExternalMediaSource({
    sourceId,
    status,
    errorClass: providerJob.error,
  });
  if (source.providerOperationId) {
    await updateProviderOperation({
      operationId: source.providerOperationId,
      status: status === "failed" ? "failed"
        : status === "publishing" ? "active"
        : status === "completed" ? "succeeded" : "accepted",
      errorClass: providerJob.error,
    });
  }
  const deleteOperation = await findSessionProviderOperation(
    source.sessionId,
    "ingress_delete",
    source.id,
  );
  if (deleteOperation && ["completed", "failed"].includes(status)) {
    await updateProviderOperation({
      operationId: deleteOperation.id,
      status: status === "completed" ? "succeeded" : "failed",
      errorClass: providerJob.error,
    });
  }
  return result.status === "updated" ? result.source : source;
}
