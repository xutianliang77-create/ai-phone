import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { findCallLink } from "../call-links/call-links.service.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { LiveKitIngressProviderAdapter } from "./livekit-ingress-provider-adapter.js";
import { SrtLiveKitIngressProviderAdapter } from
  "./srt-livekit-ingress-provider-adapter.js";
import { getLiveKitIngressConfig } from "./livekit-ingress-readiness.js";
import {
  findExternalMediaSource,
  updateExternalMediaSource,
} from "./ingress.repository.js";

export function registerIngressDeleteRoutes(app: FastifyInstance) {
  app.delete(
    "/call-links/:callId/ingress/:sourceId",
    async (request, reply) => {
      const account = requireAccount(request, reply);
      if (!account) return;
      const params = request.params as { callId: string; sourceId: string };
      const call = await findCallLink(params.callId);
      if (!call || call.userId !== account.id) {
        return sendError(reply, 404, "external_media_not_found", "External media not found");
      }
      const source = findExternalMediaSource(params.sourceId);
      if (!source || source.sessionId !== call.sessionId) {
        return sendError(reply, 404, "external_media_not_found", "External media not found");
      }
      if (["completed", "failed"].includes(source.status)) {
        return reply.status(202).send(sourceResponse(source));
      }
      if (!source.externalIngressId) {
        return sendError(reply, 409, "external_media_not_ready", "External media is not ready");
      }
      const config = getLiveKitIngressConfig();
      if (!config.ok) {
        return sendError(reply, 503, "livekit_ingress_not_configured", "Ingress unavailable");
      }
      if (source.inputType === "srt" &&
        !config.config.srtBridgeConfigured) {
        return sendError(
          reply,
          503,
          "srt_ingress_bridge_not_configured",
          "SRT bridge cleanup is unavailable",
        );
      }
      if (source.status !== "deleting") {
        updateExternalMediaSource({
          sourceId: source.id,
          status: "deleting",
          expectedVersion: source.version,
        });
      }
      const operation = beginProviderOperation({
        sessionId: source.sessionId,
        provider: "livekit_ingress",
        operationType: "ingress_delete",
        operationKey: source.id,
        idempotencyKey: `ingress-delete:${source.id}`,
        requestHash: source.externalIngressId,
      }).operation;
      const provider = source.inputType === "srt"
        ? new SrtLiveKitIngressProviderAdapter(config.config as typeof config.config & {
          srtBridgeBaseUrl: string;
          srtBridgeApiKey: string;
        })
        : new LiveKitIngressProviderAdapter(config.config);
      const result = await provider.delete({
        operationId: operation.id,
        sessionId: source.sessionId,
        expectedVersion: operation.version,
        idempotencyKey: operation.idempotencyKey,
        deadlineAt: deadline(config.config.requestTimeoutSeconds),
        payload: {
          ingressId: source.externalIngressId,
          ...(source.externalBridgeId ? { bridgeId: source.externalBridgeId } : {}),
        },
      });
      if (!result.ok) {
        updateProviderOperation({
          operationId: operation.id,
          status: result.reconciliationRequired ? "unknown" : "failed",
          errorClass: result.errorClass,
        });
        if (!result.reconciliationRequired) {
          updateExternalMediaSource({
            sourceId: source.id,
            status: "failed",
            errorClass: result.errorClass,
          });
        }
        return result.reconciliationRequired
          ? reply.status(202).send(sourceResponse(findExternalMediaSource(source.id)!))
          : sendError(reply, 503, "external_media_delete_failed", "Delete failed");
      }
      updateProviderOperation({
        operationId: operation.id,
        status: "succeeded",
        externalOperationId: result.result.ingressId,
        externalResourceId: result.result.ingressId,
      });
      updateExternalMediaSource({ sourceId: source.id, status: "completed" });
      return reply.status(202).send(sourceResponse(findExternalMediaSource(source.id)!));
    },
  );
}

function sourceResponse(source: NonNullable<ReturnType<typeof findExternalMediaSource>>) {
  return {
    id: source.id,
    sessionId: source.sessionId,
    inputType: source.inputType,
    status: source.status,
    participantIdentity: source.participantIdentity,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    endedAt: source.endedAt,
  };
}

function deadline(seconds: number) {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}
