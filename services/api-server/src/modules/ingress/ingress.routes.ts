import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ExternalMediaInputType } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { findCallLink } from "../call-links/call-links.service.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { registerIngressDeleteRoutes } from "./ingress-delete.routes.js";
import { LiveKitIngressProviderAdapter } from "./livekit-ingress-provider-adapter.js";
import { SrtLiveKitIngressProviderAdapter } from
  "./srt-livekit-ingress-provider-adapter.js";
import { applyIngressProviderJob } from "./livekit-ingress-reconciliation.js";
import {
  getLiveKitIngressConfig,
} from "./livekit-ingress-readiness.js";
import { validateIngressSourceUrl } from "./ingress-source-url-policy.js";
import {
  beginExternalMediaSource,
  findExternalMediaSource,
  findExternalMediaSourceByIdempotency,
  listSessionExternalMediaSources,
  updateExternalMediaSource,
} from "./ingress.repository.js";

export function registerIngressRoutes(app: FastifyInstance) {
  registerIngressDeleteRoutes(app);
  app.post("/call-links/:callId/ingress", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const input = parseCreateRequest(request.body);
    if (!input) {
      return sendError(reply, 400, "invalid_external_media_request", "Invalid request");
    }
    const config = getLiveKitIngressConfig();
    if (!config.ok) {
      return sendError(reply, 503, "livekit_ingress_not_configured", "Ingress unavailable");
    }
    if (input.policyVersion !== config.config.policyVersion) {
      return sendError(reply, 409, "external_media_policy_mismatch", "Policy mismatch");
    }
    const call = await findCallLink(
      (request.params as { callId: string }).callId,
    );
    if (!call || call.userId !== account.id || call.status === "ended") {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    if (input.inputType === "url" && !config.config.urlInputEnabled) {
      return sendError(reply, 409, "external_media_url_disabled", "URL input is disabled");
    }
    if (input.inputType === "srt" && !config.config.srtInputEnabled) {
      return sendError(reply, 409, "external_media_srt_disabled", "SRT input is disabled");
    }
    const requestHash = hashJson({
      sessionId: call.sessionId,
      inputType: input.inputType,
      sourceUrlHash: input.sourceUrl ? sha256(input.sourceUrl) : undefined,
      policyVersion: input.policyVersion,
    });
    const existing = findExternalMediaSourceByIdempotency(
      call.sessionId,
      input.idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return sendError(reply, 409, "external_media_operation_conflict", "Request conflict");
      }
      return reply.header("cache-control", "no-store").status(202).send({
        source: sourceResponse(existing),
        replayed: true,
      });
    }
    const sourceValidation = input.inputType === "url"
      ? await validateIngressSourceUrl(input.sourceUrl!, {
          allowedHosts: config.config.pullUrlHosts,
          maxRedirects: config.config.sourceMaxRedirects,
          timeoutMs: config.config.sourcePreflightTimeoutMs,
        })
      : null;
    if (sourceValidation && !sourceValidation.ok) {
      return sendError(reply, 400, "external_media_url_not_allowed", "Source URL not allowed");
    }
    const participantIdentity = `external:${sha256(
      `${call.sessionId}:${input.idempotencyKey}`,
    ).slice(0, 32)}`;
    const begun = beginExternalMediaSource({
      sessionId: call.sessionId,
      roomName: call.roomName,
      inputType: input.inputType,
      participantIdentity,
      sourcePolicyVersion: input.policyVersion,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      sourceUrlHash: sourceValidation?.sourceUrlHash,
      sourceFinalUrlHash: sourceValidation?.finalUrlHash,
      sourceResolutionHash: sourceValidation?.resolutionHash,
      sourceValidatedAt: sourceValidation?.validatedAt,
      maxActivePerSession: config.config.maxActivePerSession,
      maxActiveTotal: config.config.maxActiveTotal,
    });
    if (begun.status === "payload_conflict") {
      return sendError(reply, 409, "external_media_operation_conflict", "Request conflict");
    }
    if (begun.status === "capacity_exhausted") {
      return sendError(reply, 429, "external_media_capacity_exhausted", "Ingress capacity full");
    }
    if (begun.status === "replayed") {
      return reply.header("cache-control", "no-store").status(202).send({
        source: sourceResponse(begun.source),
        replayed: true,
      });
    }
    const source = begun.source;
    const operation = beginProviderOperation({
      sessionId: source.sessionId,
      provider: "livekit_ingress",
      operationType: "ingress_create",
      operationKey: source.id,
      idempotencyKey: `ingress-create:${source.id}`,
      requestHash,
    }).operation;
    updateExternalMediaSource({
      sourceId: source.id,
      status: "requested",
      expectedVersion: source.version,
      providerOperationId: operation.id,
    });
    const provider = input.inputType === "srt"
      ? new SrtLiveKitIngressProviderAdapter(config.config as typeof config.config & {
        srtBridgeBaseUrl: string;
        srtBridgeApiKey: string;
      })
      : new LiveKitIngressProviderAdapter(config.config);
    const result = await provider.create({
      operationId: operation.id,
      sessionId: source.sessionId,
      expectedVersion: operation.version,
      idempotencyKey: operation.idempotencyKey,
      deadlineAt: deadline(config.config.requestTimeoutSeconds),
      payload: {
        roomName: source.roomName,
        inputType: source.inputType,
        participantIdentity: source.participantIdentity,
        sourcePolicyVersion: source.sourcePolicyVersion,
        sourceUrl: sourceValidation?.finalUrl,
        enableTranscoding: source.inputType !== "whip",
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
        ? reply.status(202).send({ source: sourceResponse(findExternalMediaSource(source.id)!) })
        : sendError(reply, 503, "external_media_create_failed", "Ingress create failed");
    }
    updateProviderOperation({
      operationId: operation.id,
      status: "accepted",
      externalOperationId: result.result.ingressId,
      externalResourceId: result.result.ingressId,
    });
    updateExternalMediaSource({
      sourceId: source.id,
      status: "ready",
      externalIngressId: result.result.ingressId,
      externalBridgeId: result.result.bridgeId,
    });
    applyIngressProviderJob(source.id, result.result);
    return reply.header("cache-control", "no-store").status(201).send({
      source: sourceResponse(findExternalMediaSource(source.id)!),
      replayed: false,
      ...(result.result.connectionUrl
        ? {
          connection: {
            url: result.result.connectionUrl,
            ...(result.result.streamKey ? { streamKey: result.result.streamKey } : {}),
          },
        }
        : {}),
    });
  });

  app.get("/call-links/:callId/ingress", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const call = await findCallLink(
      (request.params as { callId: string }).callId,
    );
    if (!call || call.userId !== account.id) {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    return {
      sources: listSessionExternalMediaSources(call.sessionId).map(sourceResponse),
    };
  });
}

function parseCreateRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!["rtmp", "whip", "url", "srt"].includes(String(value.inputType)) ||
    !bounded(value.idempotencyKey, 128) || !bounded(value.policyVersion, 80)) return null;
  if (value.inputType === "url" && !bounded(value.sourceUrl, 2_048)) return null;
  if (value.inputType !== "url" && value.sourceUrl !== undefined) return null;
  return {
    inputType: value.inputType as ExternalMediaInputType,
    idempotencyKey: value.idempotencyKey,
    policyVersion: value.policyVersion,
    sourceUrl: value.sourceUrl as string | undefined,
  };
}

function sourceResponse(source: NonNullable<ReturnType<typeof findExternalMediaSource>>) {
  return {
    id: source.id,
    sessionId: source.sessionId,
    inputType: source.inputType,
    participantIdentity: source.participantIdentity,
    status: source.status,
    sourcePolicyVersion: source.sourcePolicyVersion,
    sourceUrlHash: source.sourceUrlHash,
    sourceFinalUrlHash: source.sourceFinalUrlHash,
    sourceResolutionHash: source.sourceResolutionHash,
    sourceValidatedAt: source.sourceValidatedAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    endedAt: source.endedAt,
  };
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value: unknown) {
  return sha256(JSON.stringify(value));
}

function deadline(seconds: number) {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}
