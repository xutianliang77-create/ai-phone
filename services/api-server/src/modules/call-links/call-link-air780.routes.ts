import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { endCallLegs } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import type { ProviderOperationRecord } from
  "../provider-operations/provider-operation-record.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  findCallLink,
  persistedCallRoomHumanPresence,
  type CallLinkRecord,
} from "./call-links.service.js";
import { ensureCallRoom } from "./call-room-worker.js";
import { parsePhoneOutboundRequest } from "./call-link-phone-request.js";
import {
  beginAir780CallLinkOutbound,
  executeAir780CallLinkOutbound,
  getAir780CallLinkTelephonyRuntime,
} from "./air780-call-link-outbound-coordinator.js";
import {
  beginProviderOperation,
  findProviderOperation,
  findSessionProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { executeAir780CallLinkHangup } from
  "./air780-call-link-outbound-coordinator.js";
import {
  air780HangupResponse,
  air780OutboundResponse,
} from "./call-link-air780-response.js";
import { configureCallLinkTranslationState } from
  "./call-link-translation-state.repository.js";
export function registerCallLinkAir780Routes(app: FastifyInstance) {
  app.get("/call-links/:callId/air780-status", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const record = await findCallLink(params.callId);
    if (!record) {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    if (record.userId !== account.id) {
      return sendError(reply, 403, "account_forbidden", "Account cannot access this resource");
    }
    const operation = await findSessionProviderOperation(
      record.sessionId,
      "phone_outbound",
    );
    if (!operation || operation.provider !== "air780_volte") {
      return sendError(reply, 404, "air780_outbound_missing", "Air780 outbound call is missing");
    }
    const runtime = getRepositoryRuntime();
    const call = runtime.driver === "postgres"
      ? await runtime.postgres.airDeviceCalls.findCallStatus({
        communicationSessionId: record.sessionId,
        providerOperationId: operation.id,
      })
      : null;
    return {
      callId: record.callId,
      sessionId: record.sessionId,
      operationId: operation.id,
      provider: operation.provider,
      providerOperationStatus: operation.status,
      ...(operation.externalResourceId
        ? { providerCallId: operation.externalResourceId }
        : {}),
      ...(call ? {
        carrierState: call.carrierState,
        callGeneration: call.callGeneration,
      } : {}),
    };
  });

  app.post("/call-links/:callId/air780-outbound", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const parsed = parsePhoneOutboundRequest(request.body);
    if (!parsed) {
      return sendError(
        reply,
        400,
        "invalid_air780_outbound_request",
        "Invalid Air780 outbound request",
      );
    }
    if (parsed.initialDtmf) {
      return sendError(
        reply,
        422,
        "air780_initial_dtmf_unsupported",
        "Air780 VUART v1 does not support initial DTMF on outbound calls",
      );
    }
    const validation = await withSessionWriteLock(params.callId, () =>
      validateDial(params.callId, account.id));
    if (!validation.ok) return sendValidationError(reply, validation);
    const runtime = getAir780CallLinkTelephonyRuntime();
    if (!runtime.ok) {
      return sendError(
        reply,
        503,
        "air780_translation_not_ready",
        runtime.issues.join("; "),
      );
    }
    const room = await ensureCallRoom(validation.record);
    if (!room.ok) {
      return sendError(reply, 503, "call_room_start_failed", "Call room could not be created");
    }
    try {
      await getCallLinkWorkerSupervisor().ensure(validation.record.callId);
    } catch (error) {
      request.log.error({ callId: validation.record.callId, err: error },
        "Call room Worker was not ready before Air780 dial");
      return sendError(
        reply,
        503,
        "call_room_worker_unavailable",
        "Call room translation worker is not ready",
      );
    }
    const started = await withSessionWriteLock(params.callId, async () => {
      const current = await validateDial(params.callId, account.id);
      if (!current.ok) return current;
      if (!await configureCallLinkTranslationState({
        sessionId: current.record.sessionId,
        sourceLanguage: parsed.sourceLanguage,
        targetLanguage: parsed.targetLanguage,
      })) return failure(409, "translation_language_binding_conflict",
        "Translation language binding conflicts");
      return {
        ok: true as const,
        record: current.record,
        operation: await beginAir780CallLinkOutbound({
          record: current.record,
          request: parsed,
        }),
      };
    });
    if (!started.ok) return sendValidationError(reply, started);
    if (started.operation.status === "payload_conflict" ||
      started.operation.status === "session_conflict") {
      return sendError(
        reply,
        409,
        "air780_outbound_operation_conflict",
        "This call session already has an outbound dial operation",
      );
    }
    if (started.operation.status === "replayed") {
      return reply.status(202).send(air780OutboundResponse(
        started.record,
        started.operation.operation,
        true,
      ));
    }
    const result = await executeAir780CallLinkOutbound({
      record: started.record,
      request: parsed,
      operation: started.operation.operation,
    });
    if (result.ok) {
      return reply.status(202).send(air780OutboundResponse(
        started.record,
        result.operation,
        result.replayed,
        result.participantIdentity,
        result.providerCallId,
      ));
    }
    if (result.reconciliationRequired) {
      return reply.status(202).send(air780OutboundResponse(
        started.record,
        result.operation,
        false,
      ));
    }
    await failUnansweredCall(started.record);
    await getCallLinkWorkerSupervisor().stop(started.record.callId);
    return sendError(
      reply,
      503,
      "air780_outbound_failed",
      "Air780 rejected the outbound call",
    );
  });

  app.post("/call-links/:callId/air780-hangup", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const validation = await withSessionWriteLock(params.callId, () =>
      validateControl(params.callId, account.id));
    if (!validation.ok) return sendValidationError(reply, validation);
    const runtime = getAir780CallLinkTelephonyRuntime();
    if (!runtime.ok) {
      return sendError(reply, 503, "air780_translation_not_ready", runtime.issues.join("; "));
    }
    const started = await withSessionWriteLock(params.callId, async () => {
      const current = await validateControl(params.callId, account.id);
      if (!current.ok) return current;
      const operation = await beginProviderOperation({
        sessionId: current.record.sessionId,
        provider: "air780_volte",
        operationType: "phone_hangup",
        operationKey: "hangup",
        idempotencyKey: `phone-hangup:${current.record.sessionId}`,
        requestHash: JSON.stringify({
          sessionId: current.record.sessionId,
          dialOperationId: current.dial.id,
        }),
      });
      return { ok: true as const, record: current.record, dial: current.dial, operation };
    });
    if (!started.ok) return sendValidationError(reply, started);
    if (started.operation.status === "payload_conflict" ||
      started.operation.status === "session_conflict") {
      return sendError(reply, 409, "air780_hangup_operation_conflict", "Hangup conflicts with an existing operation");
    }
    const retryableUndispatchedHangup =
      started.operation.status === "replayed" &&
      started.operation.operation.status === "failed" &&
      started.operation.operation.lastErrorClass === "unavailable";
    if (started.operation.status === "replayed" &&
      !retryableUndispatchedHangup) {
      if (["failed", "cancelled"].includes(started.operation.operation.status)) {
        return sendError(
          reply,
          503,
          "air780_hangup_failed",
          "Air780 hangup was rejected",
        );
      }
      return reply.status(202).send(air780HangupResponse(
        started.record.callId,
        started.operation.operation,
        true,
      ));
    }
    let payload;
    try {
      payload = await runtime.runtime.resolveControlPayload({
        record: started.record,
        operation: started.dial,
        action: "hangup",
      });
    } catch {
      // No provider side effect can occur before the binding resolves. Mark
      // this exact hangup operation as definitely undispatched so a later
      // request can safely retry it without creating a new command identity.
      await updateProviderOperation({
        operationId: started.operation.operation.id,
        status: "failed",
        expectedVersion: started.operation.operation.version,
        errorClass: "unavailable",
      });
      return sendError(reply, 409, "air780_call_binding_missing", "Air780 call binding is unavailable");
    }
    const result = await executeAir780CallLinkHangup({
      operation: started.operation.operation,
      provider: runtime.runtime.adapter,
      payload,
      timeoutMs: runtime.runtime.timeoutMs,
    });
    const current = await findProviderOperation(started.operation.operation.id) ??
      started.operation.operation;
    const convergedDespiteRetryRace = ["accepted", "active", "succeeded"]
      .includes(current.status);
    if (!result.ok && !result.reconciliationRequired &&
      !convergedDespiteRetryRace) {
      return sendError(reply, 503, "air780_hangup_failed", "Air780 hangup was rejected");
    }
    return reply.status(202).send(air780HangupResponse(
      started.record.callId,
      current,
      started.operation.status === "replayed" ||
        (result.ok && result.replayed),
    ));
  });
}

type DialValidation =
  | { ok: true; record: CallLinkRecord }
  | { ok: false; status: 403 | 404 | 409 | 410; code: string; message: string };

type ControlValidation =
  | { ok: true; record: CallLinkRecord; dial: ProviderOperationRecord }
  | { ok: false; status: 403 | 404 | 409 | 410; code: string; message: string };

async function validateDial(callId: string, accountId: string): Promise<DialValidation> {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) return failure(403, "account_forbidden", "Account cannot access this resource");
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const presence = await persistedCallRoomHumanPresence(callId);
  if (presence.activeHostCount !== 1) return failure(409, "phone_host_not_connected", "Host must join before dialing");
  const existingPhone = await findSessionProviderOperation(record.sessionId, "phone_outbound");
  const existingSip = await findSessionProviderOperation(record.sessionId, "sip_outbound");
  if (existingPhone || existingSip || presence.activeGuestCount > 0) {
    return failure(409, "phone_outbound_operation_conflict", "This call session already has an outbound call");
  }
  return { ok: true, record };
}

async function validateControl(callId: string, accountId: string): Promise<ControlValidation> {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) return failure(403, "account_forbidden", "Account cannot access this resource");
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const dial = await findSessionProviderOperation(record.sessionId, "phone_outbound");
  if (!dial || dial.provider !== "air780_volte") {
    return failure(409, "air780_outbound_missing", "Air780 outbound call is missing");
  }
  if (!["accepted", "unknown", "active"].includes(dial.status)) {
    return failure(409, "air780_call_not_active", "Air780 call is not active");
  }
  return { ok: true, record, dial };
}
function sendValidationError(
  reply: Parameters<typeof sendError>[0],
  result: Exclude<DialValidation | ControlValidation, { ok: true }>,
) {
  return sendError(reply, result.status, result.code, result.message);
}

function failure(
  status: 403 | 404 | 409 | 410,
  code: string,
  message: string,
): Exclude<DialValidation | ControlValidation, { ok: true }> {
  return { ok: false, status, code, message };
}
function failUnansweredCall(record: CallLinkRecord) {
  return withSessionWriteLock(record.callId, async () => {
    const session = await completeSessionWithUsage(record.sessionId, { billableSeconds: 0 });
    if (session?.endedAt) await endCallLegs(session.id, session.endedAt);
    return session;
  });
}
