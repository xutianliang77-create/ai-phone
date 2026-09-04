import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import { withSessionWriteLock } from
  "../sessions/session-write-coordinator.js";
import {
  executeAir780CallLinkDtmf,
  getAir780CallLinkTelephonyRuntime,
} from "./air780-call-link-outbound-coordinator.js";
import { air780DtmfResponse } from "./call-link-air780-response.js";
import { findCallLink, type CallLinkRecord } from "./call-links.service.js";

export function registerCallLinkAir780DtmfRoutes(app: FastifyInstance) {
  app.post("/call-links/:callId/air780-dtmf", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const body = parseAir780Dtmf(request.body);
    if (!body) {
      return sendError(
        reply,
        400,
        "invalid_air780_dtmf_request",
        "Invalid Air780 DTMF request",
      );
    }
    const runtime = getAir780CallLinkTelephonyRuntime();
    if (!runtime.ok) {
      return sendError(
        reply,
        503,
        "air780_translation_not_ready",
        runtime.issues.join("; "),
      );
    }
    const started = await withSessionWriteLock(params.callId, async () => {
      const binding = await validateAir780Dtmf(
        params.callId,
        account.id,
      );
      if (!binding.ok) return binding;
      const operation = await beginProviderOperation({
        sessionId: binding.record.sessionId,
        provider: "air780_volte",
        operationType: "phone_dtmf",
        operationKey: body.idempotencyKey,
        idempotencyKey:
          `phone-dtmf:${binding.record.sessionId}:${body.idempotencyKey}`,
        requestHash: requestHash(binding.dial.id, body),
      });
      if (operation.status === "payload_conflict" ||
          operation.status === "session_conflict") {
        return failure(
          409,
          "air780_dtmf_operation_conflict",
          "Air780 DTMF operation conflicts",
        );
      }
      return {
        ok: true as const,
        record: binding.record,
        dial: binding.dial,
        operation: operation.operation,
        replayed: operation.status === "replayed",
      };
    });
    if (!started.ok) return validationError(reply, started);
    const replayedInFlight = started.replayed &&
      started.operation.status === "in_flight";
    if (replayedInFlight ||
      ["accepted", "active", "succeeded", "unknown"].includes(
        started.operation.status,
      )) {
      return reply.status(202).send(air780DtmfResponse(
        started.record.callId,
        started.operation,
        true,
      ));
    }
    if (["failed", "cancelled"].includes(started.operation.status) &&
      started.operation.lastErrorClass !== "unavailable") {
      return sendError(
        reply,
        422,
        "air780_dtmf_rejected",
        "Air780 DTMF was rejected",
      );
    }
    let payload;
    try {
      payload = await runtime.runtime.resolveControlPayload({
        record: started.record,
        operation: started.dial,
        action: "dtmf",
      });
    } catch {
      await markDefinitelyUndispatched(started.operation);
      return sendError(
        reply,
        409,
        "air780_dtmf_not_connected",
        "Air780 call is not connected for DTMF",
      );
    }
    const result = await executeAir780CallLinkDtmf({
      operation: started.operation,
      provider: runtime.runtime.adapter,
      payload: { ...payload, digits: body.digit },
      timeoutMs: runtime.runtime.timeoutMs,
    });
    const current = await findProviderOperation(started.operation.id) ??
      started.operation;
    if (!result.ok && !result.reconciliationRequired) {
      const definitelyUndispatched = result.errorClass === "unavailable";
      return sendError(
        reply,
        definitelyUndispatched ? 503 : 422,
        definitelyUndispatched
          ? "air780_dtmf_not_dispatched"
          : "air780_dtmf_rejected",
        definitelyUndispatched
          ? "Air780 DTMF was not dispatched"
          : "Air780 DTMF was rejected",
      );
    }
    return reply.status(202).send(air780DtmfResponse(
      started.record.callId,
      current,
      started.replayed || (result.ok && result.replayed),
    ));
  });
}

async function validateAir780Dtmf(callId: string, accountId: string) {
  const record = await findCallLink(callId);
  if (!record) {
    return failure(404, "call_link_not_found", "Call link not found");
  }
  if (record.userId !== accountId) {
    return failure(403, "account_forbidden", "Account cannot access this resource");
  }
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const dial = await findSessionProviderOperation(
    record.sessionId,
    "phone_outbound",
  );
  if (!dial || dial.provider !== "air780_volte") {
    return failure(
      409,
      "air780_outbound_missing",
      "Air780 outbound call is missing",
    );
  }
  if (!["accepted", "active", "unknown"].includes(dial.status)) {
    return failure(409, "air780_call_not_active", "Air780 call is not active");
  }
  return { ok: true as const, record, dial };
}

function parseAir780Dtmf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  return typeof body.digit === "string" &&
      /^[0-9*#A-D]$/.test(body.digit) && validKey(body.idempotencyKey)
    ? { digit: body.digit, idempotencyKey: body.idempotencyKey }
    : null;
}

function requestHash(
  dialOperationId: string,
  body: { digit: string; idempotencyKey: string },
) {
  return createHmac("sha256", process.env.INTERNAL_API_SECRET ?? "")
    .update(JSON.stringify({ dialOperationId, digit: body.digit }))
    .digest("hex");
}

async function markDefinitelyUndispatched(operation: ProviderOperationRecord) {
  await updateProviderOperation({
    operationId: operation.id,
    status: "failed",
    expectedVersion: operation.version,
    errorClass: "unavailable",
  });
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

function failure(
  status: 403 | 404 | 409 | 410,
  code: string,
  message: string,
) {
  return { ok: false as const, status, code, message };
}

function validationError(
  reply: FastifyReply,
  result: { status: 403 | 404 | 409 | 410; code: string; message: string },
) {
  return sendError(reply, result.status, result.code, result.message);
}
