import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { TelephonyInboundProvider } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  findActiveProviderOperations,
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import type { ProviderOperationRecord } from "../provider-operations/provider-operation-record.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  findCallLink,
  persistedCallRoomHumanPresence,
} from "./call-links.service.js";
import { ensureCallRoom } from "./call-room-worker.js";
import { LiveKitSipInboundProviderAdapter } from "./livekit-sip-inbound-provider-adapter.js";
import {
  getLiveKitSipConfig,
  type LiveKitSipConfig,
} from "./livekit-sip-readiness.js";

type Factory = (config: LiveKitSipConfig) => TelephonyInboundProvider;
let testFactory: Factory | null = null;

export function setLiveKitSipInboundProviderFactoryForTests(factory: Factory | null) {
  testFactory = factory;
}

export function registerCallLinkSipInboundRoutes(app: FastifyInstance) {
  app.post("/call-links/:callId/sip-inbound", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const body = parseOpenRequest(request.body);
    if (!body) return sendError(reply, 400, "invalid_sip_inbound_request", "Invalid request");
    const config = getLiveKitSipConfig();
    if (!config.ok || !config.config.inbound) return notConfigured(reply);
    const inboundConfig = config.config.inbound;
    const initial = await validateOpen(params.callId, account.id);
    if (!initial.ok) return validationError(reply, initial);
    const room = await ensureCallRoom(initial.record);
    if (!room.ok) return sendError(reply, 503, "call_room_start_failed", "Room failed");
    try {
      await getCallLinkWorkerSupervisor().ensure(initial.record.callId);
    } catch {
      return sendError(reply, 503, "call_room_worker_unavailable", "Worker unavailable");
    }
    const started = await withSessionWriteLock(params.callId, async () => {
      const validation = await validateOpen(params.callId, account.id);
      if (!validation.ok) return validation;
      const operation = beginProviderOperation({
        sessionId: validation.record.sessionId,
        provider: "livekit_sip",
        operationType: "sip_inbound",
        operationKey: "primary",
        idempotencyKey: `sip-inbound:${validation.record.sessionId}:${body.idempotencyKey}`,
        requestHash: hash({ sessionId: validation.record.sessionId, pin: body.pin }),
      });
      if (operation.status === "payload_conflict" || operation.status === "session_conflict") {
        return failure(409, "sip_inbound_operation_conflict", "Inbound binding conflicts");
      }
      return {
        ok: true as const,
        record: validation.record,
        operation: operation.operation,
        replayed: operation.status === "replayed",
      };
    });
    if (!started.ok) return validationError(reply, started);
    if (started.replayed) return reply.status(202).send(response(
      started.record.callId,
      started.operation,
      inboundConfig.displayNumber,
      true,
    ));
    const provider = providerFor(config.config);
    const result = await provider.createDispatch({
      ...context(started.operation, config.config.requestTimeoutSeconds),
      payload: {
        roomName: started.record.roomName,
        trunkId: inboundConfig.trunkId,
        pin: body.pin,
        attributes: {
          "translation.operationId": started.operation.id,
          "translation.sessionId": started.record.sessionId,
          "translation.role": "guest",
          "translation.direction": "inbound",
        },
      },
    });
    updateProviderOperation({
      operationId: started.operation.id,
      status: result.ok ? "accepted" : result.reconciliationRequired ? "unknown" : "failed",
      errorClass: result.ok ? undefined : result.errorClass,
      ...(result.ok ? { externalResourceId: result.result.dispatchRuleId } : {}),
    });
    const current = findProviderOperation(started.operation.id) ?? started.operation;
    if (!result.ok && !result.reconciliationRequired) {
      return sendError(reply, 503, "sip_inbound_failed", "Inbound binding failed");
    }
    return reply.status(202).send(response(
      started.record.callId,
      current,
      inboundConfig.displayNumber,
      false,
    ));
  });

  app.post("/call-links/:callId/sip-inbound/close", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const record = await findCallLink(params.callId);
    if (!record) return sendError(reply, 404, "call_link_not_found", "Call link not found");
    if (record.userId !== account.id) return sendError(reply, 403, "account_forbidden", "Forbidden");
    const operation = findSessionProviderOperation(record.sessionId, "sip_inbound", "primary");
    if (!operation) return sendError(reply, 404, "sip_inbound_not_found", "Inbound binding not found");
    const result = await closeLiveKitSipInbound(operation, "host_close");
    return reply.status(result.status === "failed" ? 503 : 202).send(result);
  });
}

export async function closeLiveKitSipInbound(
  inbound: ProviderOperationRecord,
  reason: string,
) {
  if (inbound.operationType !== "sip_inbound" || !inbound.externalResourceId) {
    return { status: "ignored" as const, operationId: inbound.id };
  }
  const config = getLiveKitSipConfig();
  if (!config.ok || !config.config.inbound) {
    return { status: "not_configured" as const, operationId: inbound.id };
  }
  const begun = beginProviderOperation({
    sessionId: inbound.sessionId,
    provider: "livekit_sip",
    operationType: "sip_inbound_close",
    operationKey: inbound.id,
    idempotencyKey: `sip-inbound-close:${inbound.id}`,
    requestHash: hash({ inboundOperationId: inbound.id, ruleId: inbound.externalResourceId }),
  });
  if (begun.status === "payload_conflict" || begun.status === "session_conflict") {
    return { status: "conflict" as const, operationId: begun.operation.id };
  }
  if (begun.status === "replayed" && ["succeeded", "failed"].includes(begun.operation.status)) {
    return { status: begun.operation.status, operationId: begun.operation.id, replayed: true };
  }
  const result = await providerFor(config.config).deleteDispatch({
    ...context(begun.operation, config.config.requestTimeoutSeconds),
    payload: { dispatchRuleId: inbound.externalResourceId },
  });
  const status = result.ok ? "succeeded" : result.reconciliationRequired ? "unknown" : "failed";
  updateProviderOperation({
    operationId: begun.operation.id,
    status,
    errorClass: result.ok ? undefined : result.errorClass,
    externalResourceId: inbound.externalResourceId,
  });
  if (result.ok && !["succeeded", "failed", "cancelled"].includes(inbound.status)) {
    updateProviderOperation({ operationId: inbound.id, status: "succeeded" });
  }
  return { status, operationId: begun.operation.id, reason };
}

async function validateOpen(callId: string, accountId: string) {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) return failure(403, "account_forbidden", "Forbidden");
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  if ((await persistedCallRoomHumanPresence(callId)).activeHostCount !== 1) {
    return failure(409, "sip_host_not_connected", "Host must join first");
  }
  const occupied = findActiveProviderOperations("sip_inbound").find(
    (operation) => operation.sessionId !== record.sessionId,
  );
  if (occupied) return failure(409, "sip_inbound_trunk_busy", "Inbound trunk is reserved");
  return { ok: true as const, record };
}

function parseOpenRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  return typeof value.pin === "string" && /^\d{4,12}$/.test(value.pin) &&
    typeof value.idempotencyKey === "string" &&
    /^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey)
    ? { pin: value.pin, idempotencyKey: value.idempotencyKey }
    : null;
}

function providerFor(config: LiveKitSipConfig) {
  return (testFactory ?? ((value) => new LiveKitSipInboundProviderAdapter(value)))(config);
}

function context(operation: ProviderOperationRecord, timeoutSeconds: number) {
  return {
    operationId: operation.id,
    sessionId: operation.sessionId,
    expectedVersion: operation.version,
    idempotencyKey: operation.idempotencyKey,
    deadlineAt: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
  };
}

function response(
  callId: string,
  operation: ProviderOperationRecord,
  displayNumber: string,
  replayed: boolean,
) {
  return {
    callId,
    sessionId: operation.sessionId,
    operationId: operation.id,
    status: operation.status,
    displayNumber,
    replayed,
  };
}

function hash(value: unknown) {
  return createHmac("sha256", process.env.INTERNAL_API_SECRET ?? "")
    .update(JSON.stringify(value)).digest("hex");
}

function failure(status: 403 | 404 | 409 | 410, code: string, message: string) {
  return { ok: false as const, status, code, message };
}

function validationError(reply: any, value: { status: number; code: string; message: string }) {
  return sendError(reply, value.status, value.code, value.message);
}

function notConfigured(reply: any) {
  return sendError(reply, 503, "livekit_sip_inbound_not_configured", "Inbound SIP is disabled");
}
