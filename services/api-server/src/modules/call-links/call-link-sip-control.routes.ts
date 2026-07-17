import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  isSipDtmfDigit,
  type ProviderOperationType,
  type SipDtmfRequest,
  type SipTransferRequest,
  type TelephonyControlProvider,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import type { ProviderOperationRecord } from "../provider-operations/provider-operation-record.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { isInternalAuthorized } from "./call-link-internal.routes.js";
import { findCallLink, type CallLinkRecord } from "./call-links.service.js";
import { liveKitSipParticipantIdentity } from "./livekit-sip-identity.js";
import { LiveKitSipControlPublisher } from "./livekit-sip-control-publisher.js";
import { LiveKitSipProviderAdapter } from "./livekit-sip-provider-adapter.js";
import {
  getLiveKitSipConfig,
  type LiveKitSipConfig,
} from "./livekit-sip-readiness.js";

type ControlProviderFactory = (config: LiveKitSipConfig) => TelephonyControlProvider;
type ControlPublisher = Pick<LiveKitSipControlPublisher, "publishDtmf">;
let testProviderFactory: ControlProviderFactory | null = null;
let testPublisher: ControlPublisher | null = null;

export function setLiveKitSipControlFactoriesForTests(input: {
  provider?: ControlProviderFactory | null;
  publisher?: ControlPublisher | null;
}) {
  if (input.provider !== undefined) testProviderFactory = input.provider;
  if (input.publisher !== undefined) testPublisher = input.publisher;
}

export function registerCallLinkSipControlRoutes(app: FastifyInstance) {
  app.post("/call-links/:callId/sip-dtmf", (request, reply) =>
    handleDtmf(request, reply));
  app.post("/call-links/:callId/sip-transfer", (request, reply) =>
    handleProviderControl(request, reply, "sip_transfer"));
  app.post("/call-links/:callId/sip-hangup", (request, reply) =>
    handleProviderControl(request, reply, "sip_hangup"));
  app.post(
    "/internal/call-links/:callId/sip-controls/:operationId/status",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(reply, 401, "internal_error", "Unauthorized internal request");
      }
      const params = request.params as { callId: string; operationId: string };
      const body = parseWorkerStatus(request.body);
      if (!body) {
        return sendError(reply, 400, "invalid_sip_control_status", "Invalid status");
      }
      return withSessionWriteLock(params.callId, () => {
        const operation = findProviderOperation(params.operationId);
        const dial = findSessionProviderOperation(params.callId, "sip_outbound");
        if (!operation || operation.sessionId !== params.callId ||
          operation.operationType !== "sip_dtmf" ||
          !dial || dial.id !== body.dialOperationId) {
          return sendError(reply, 409, "sip_control_binding_conflict", "Binding failed");
        }
        if (operation.status === body.status) return controlResponse(params.callId, operation, true);
        if (operation.status === "succeeded" || operation.status === "failed") {
          return sendError(reply, 409, "sip_control_terminal_conflict", "Status is terminal");
        }
        const result = updateProviderOperation({
          operationId: operation.id,
          status: body.status,
          errorClass: body.errorClass,
        });
        return controlResponse(
          params.callId,
          "operation" in result && result.operation ? result.operation : operation,
          false,
        );
      });
    },
  );
}

async function handleDtmf(request: any, reply: any) {
  const account = requireAccount(request, reply);
  if (!account) return;
  const params = request.params as { callId: string };
  const body = parseDtmf(request.body);
  if (!body) return sendError(reply, 400, "invalid_sip_dtmf_request", "Invalid DTMF request");
  const config = getLiveKitSipConfig();
  if (!config.ok) return notConfigured(reply);
  const started = await withSessionWriteLock(params.callId, () =>
    beginControl(params.callId, account.id, "sip_dtmf", body.idempotencyKey, body));
  if (!started.ok) return validationError(reply, started);
  if (started.replayed) return reply.status(202).send(
    controlResponse(params.callId, started.operation, true),
  );
  const accepted = updateProviderOperation({
    operationId: started.operation.id,
    status: "accepted",
    expectedVersion: started.operation.version,
  });
  const operation = "operation" in accepted && accepted.operation
    ? accepted.operation
    : started.operation;
  const publisher = testPublisher ?? new LiveKitSipControlPublisher(config.config);
  try {
    await publisher.publishDtmf(started.record.roomName, {
      version: 1,
      type: "sip.dtmf",
      callId: started.record.callId,
      dialOperationId: started.dial.id,
      controlOperationId: operation.id,
      digit: body.digit,
    });
  } catch (error) {
    const definite = error instanceof Error && error.name === "SipControlWorkerBindingError";
    updateProviderOperation({
      operationId: operation.id,
      status: definite ? "failed" : "unknown",
      errorClass: definite ? "worker_binding" : "delivery_unknown",
    });
  }
  return reply.status(202).send(controlResponse(
    params.callId,
    findProviderOperation(operation.id) ?? operation,
    false,
  ));
}

async function handleProviderControl(
  request: any,
  reply: any,
  type: "sip_transfer" | "sip_hangup",
) {
  const account = requireAccount(request, reply);
  if (!account) return;
  const params = request.params as { callId: string };
  const body = type === "sip_transfer" ? parseTransfer(request.body) : null;
  if (type === "sip_transfer" && !body) {
    return sendError(reply, 400, "invalid_sip_transfer_request", "Invalid transfer request");
  }
  const config = getLiveKitSipConfig();
  if (!config.ok) return notConfigured(reply);
  const key = body?.idempotencyKey ?? `hangup:${params.callId}`;
  const started = await withSessionWriteLock(params.callId, () =>
    beginControl(params.callId, account.id, type, key, body ?? { hangup: true }));
  if (!started.ok) return validationError(reply, started);
  if (started.replayed) return reply.status(202).send(
    controlResponse(params.callId, started.operation, true),
  );
  const provider = (testProviderFactory ??
    ((value) => new LiveKitSipProviderAdapter(value)))(config.config);
  const context = {
    operationId: started.operation.id,
    sessionId: started.record.sessionId,
    expectedVersion: started.operation.version,
    idempotencyKey: started.operation.idempotencyKey,
    deadlineAt: new Date(Date.now() + config.config.requestTimeoutSeconds * 1000).toISOString(),
  };
  const participantIdentity = liveKitSipParticipantIdentity(
    started.record.sessionId,
    started.dial.id,
  );
  const result = type === "sip_transfer"
    ? await provider.transferParticipant({
      ...context,
      payload: {
        roomName: started.record.roomName,
        participantIdentity,
        transferTo: `tel:${body!.targetPhone}`,
      },
    })
    : await provider.removeParticipant({
      ...context,
      payload: { roomName: started.record.roomName, participantIdentity },
    });
  const successfulHangup = type === "sip_hangup" && !result.ok &&
    result.errorClass === "not_found";
  const status = result.ok || successfulHangup
    ? "succeeded"
    : result.reconciliationRequired ? "unknown" : "failed";
  updateProviderOperation({
    operationId: started.operation.id,
    status,
    errorClass: result.ok ? undefined : result.errorClass,
    ...(result.ok && result.externalResourceId
      ? { externalResourceId: result.externalResourceId }
      : {}),
  });
  const current = findProviderOperation(started.operation.id) ?? started.operation;
  if (status === "failed") {
    return sendError(reply, 503, "sip_control_failed", "SIP control was rejected");
  }
  return reply.status(202).send(controlResponse(params.callId, current, false));
}

async function beginControl(
  callId: string,
  accountId: string,
  type: "sip_dtmf" | "sip_transfer" | "sip_hangup",
  idempotencyKey: string,
  payload: unknown,
) {
  const binding = await validateBinding(callId, accountId, type);
  if (!binding.ok) return binding;
  const result = beginProviderOperation({
    sessionId: binding.record.sessionId,
    provider: "livekit_sip",
    operationType: type,
    operationKey: idempotencyKey,
    idempotencyKey: `${type}:${binding.record.sessionId}:${idempotencyKey}`,
    requestHash: hash({ dialOperationId: binding.dial.id, payload }),
  });
  if (result.status === "payload_conflict" || result.status === "session_conflict") {
    return failure(409, "sip_control_operation_conflict", "Control operation conflicts");
  }
  return {
    ok: true as const,
    record: binding.record,
    dial: binding.dial,
    operation: result.operation,
    replayed: result.status === "replayed",
  };
}

async function validateBinding(
  callId: string,
  accountId: string,
  type: "sip_dtmf" | "sip_transfer" | "sip_hangup",
) {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) return failure(403, "account_forbidden", "Forbidden");
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const dial = findSessionProviderOperation(record.sessionId, "sip_outbound");
  if (!dial) return failure(409, "sip_outbound_missing", "Outbound call is missing");
  const allowed = type === "sip_hangup"
    ? ["accepted", "unknown", "active"]
    : ["active"];
  if (!allowed.includes(dial.status)) {
    return failure(409, "sip_call_not_active", "SIP call is not active");
  }
  return { ok: true as const, record, dial };
}

function parseDtmf(body: unknown): SipDtmfRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  return isSipDtmfDigit(value.digit) && validKey(value.idempotencyKey)
    ? { digit: value.digit, idempotencyKey: value.idempotencyKey }
    : null;
}

function parseTransfer(body: unknown): SipTransferRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  return typeof value.targetPhone === "string" && /^\+[1-9]\d{7,14}$/.test(value.targetPhone) &&
    validKey(value.idempotencyKey)
    ? { targetPhone: value.targetPhone, idempotencyKey: value.idempotencyKey }
    : null;
}

function parseWorkerStatus(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!validId(value.dialOperationId) ||
    (value.status !== "succeeded" && value.status !== "failed") ||
    (value.errorClass !== undefined && !validId(value.errorClass))) return null;
  return {
    dialOperationId: value.dialOperationId,
    status: value.status,
    ...(value.errorClass ? { errorClass: value.errorClass } : {}),
  } as { dialOperationId: string; status: "succeeded" | "failed"; errorClass?: string };
}

function controlResponse(callId: string, operation: ProviderOperationRecord, replayed: boolean) {
  return {
    callId,
    sessionId: operation.sessionId,
    operationId: operation.id,
    operationType: operation.operationType as ProviderOperationType,
    status: operation.status,
    replayed,
  };
}

function hash(value: unknown) {
  return createHmac("sha256", process.env.INTERNAL_API_SECRET ?? "")
    .update(JSON.stringify(value)).digest("hex");
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}

function failure(status: 403 | 404 | 409 | 410, code: string, message: string) {
  return { ok: false as const, status, code, message };
}

function validationError(reply: any, result: { status: number; code: string; message: string }) {
  return sendError(reply, result.status as 403, result.code, result.message);
}

function notConfigured(reply: any) {
  return sendError(reply, 503, "livekit_sip_not_configured", "LiveKit SIP is not configured");
}
