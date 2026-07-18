import type { FastifyInstance } from "fastify";
import {
  isTranslationLanguage,
  type CreateSipOutboundCallRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { endCallLegs } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { findSessionProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import type { ProviderOperationRecord } from "../provider-operations/provider-operation-record.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  findCallLink,
  persistedCallRoomHumanPresence,
  type CallLinkRecord,
} from "./call-links.service.js";
import { ensureCallRoom } from "./call-room-worker.js";
import {
  beginLiveKitSipOutbound,
  executeLiveKitSipOutbound,
  setLiveKitSipOutboundProviderFactoryForTests,
} from "./livekit-sip-outbound-coordinator.js";
import {
  getLiveKitSipConfig,
  type LiveKitSipConfig,
} from "./livekit-sip-readiness.js";

export function setLiveKitSipProviderFactoryForTests(
  factory: Parameters<typeof setLiveKitSipOutboundProviderFactoryForTests>[0],
) {
  setLiveKitSipOutboundProviderFactoryForTests(factory);
}

export function registerCallLinkSipRoutes(app: FastifyInstance) {
  app.post("/call-links/:callId/sip-outbound", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const parsed = parseRequest(request.body);
    if (!parsed) {
      return sendError(
        reply,
        400,
        "invalid_sip_outbound_request",
        "Invalid SIP outbound request",
      );
    }
    const config = getLiveKitSipConfig();
    if (!config.ok) {
      return sendError(
        reply,
        503,
        "livekit_sip_not_configured",
        "LiveKit SIP is not configured",
      );
    }

    const initial = await withSessionWriteLock(params.callId, () =>
      validateDial(params.callId, account.id));
    if (!initial.ok) return sendValidationError(reply, initial);
    const room = await ensureCallRoom(initial.record);
    if (!room.ok) {
      return sendError(reply, 503, "call_room_start_failed", "Call room could not be created");
    }
    try {
      await getCallLinkWorkerSupervisor().ensure(initial.record.callId);
    } catch (error) {
      request.log.error(
        { callId: initial.record.callId, err: error },
        "Call room Worker was not ready before SIP dial",
      );
      return sendError(
        reply,
        503,
        "call_room_worker_unavailable",
        "Call room translation worker is not ready",
      );
    }

    const started = await withSessionWriteLock(params.callId, async () => {
      const validation = await validateDial(params.callId, account.id);
      if (!validation.ok) return validation;
      return {
        ok: true as const,
        record: validation.record,
        operation: await beginLiveKitSipOutbound({
          record: validation.record,
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
        "sip_outbound_operation_conflict",
        "This call session already has an outbound dial operation",
      );
    }
    if (started.operation.status === "replayed") {
      return reply.status(202).send(responseBody(
        started.record,
        started.operation.operation,
        true,
      ));
    }

    const operation = started.operation.operation;
    const result = await executeLiveKitSipOutbound({
      record: started.record,
      request: parsed,
      operation,
      config: config.config,
    });
    if (result.ok) {
      return reply.status(202).send(responseBody(
        started.record,
        result.operation,
        result.replayed,
        result.participantIdentity,
      ));
    }
    if (result.reconciliationRequired) {
      return reply.status(202).send(responseBody(
        started.record,
        result.operation,
        false,
      ));
    }
    if (result.operation.status !== "failed") {
      return reply.status(202).send(responseBody(
        started.record,
        result.operation,
        false,
      ));
    }
    await failUnansweredCall(started.record);
    await getCallLinkWorkerSupervisor().stop(started.record.callId);
    return sendError(
      reply,
      result.errorClass === "invalid_request" ? 422 : 503,
      "sip_outbound_failed",
      "LiveKit SIP rejected the outbound call",
    );
  });
}

type DialValidation =
  | { ok: true; record: CallLinkRecord }
  | { ok: false; status: 403 | 404 | 409 | 410; code: string; message: string };

async function validateDial(
  callId: string,
  accountId: string,
): Promise<DialValidation> {
  const record = await findCallLink(callId);
  if (!record) return failure(404, "call_link_not_found", "Call link not found");
  if (record.userId !== accountId) {
    return failure(403, "account_forbidden", "Account cannot access this resource");
  }
  if (record.status === "ended" || Date.now() >= Date.parse(record.expiresAt)) {
    return failure(410, "call_link_expired", "Call link expired");
  }
  const presence = await persistedCallRoomHumanPresence(callId);
  if (presence.activeHostCount !== 1) {
    return failure(409, "sip_host_not_connected", "Host must join before dialing");
  }
  const existing = await findSessionProviderOperation(record.sessionId, "sip_outbound");
  if (presence.activeGuestCount > 0 && !existing) {
    return failure(409, "sip_guest_already_connected", "A guest is already connected");
  }
  return { ok: true, record };
}

function parseRequest(body: unknown): CreateSipOutboundCallRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  const targetPhone = typeof value.targetPhone === "string"
    ? value.targetPhone.trim()
    : "";
  const sourceLanguage = typeof value.sourceLanguage === "string"
    ? value.sourceLanguage
    : "";
  const targetLanguage = typeof value.targetLanguage === "string"
    ? value.targetLanguage
    : "";
  const initialDtmf = typeof value.initialDtmf === "string"
    ? value.initialDtmf.trim()
    : undefined;
  if (!/^\+[1-9]\d{7,14}$/.test(targetPhone) ||
    !isTranslationLanguage(sourceLanguage) ||
    !isTranslationLanguage(targetLanguage) ||
    !["zh", "en"].includes(sourceLanguage) ||
    !["zh", "en"].includes(targetLanguage) ||
    sourceLanguage === targetLanguage || value.disclosureConfirmed !== true ||
    (initialDtmf !== undefined && !/^[0-9*#A-Dw]{1,64}$/.test(initialDtmf))) {
    return null;
  }
  return {
    targetPhone,
    sourceLanguage,
    targetLanguage,
    disclosureConfirmed: true,
    ...(initialDtmf ? { initialDtmf } : {}),
  };
}

function responseBody(
  record: CallLinkRecord,
  operation: ProviderOperationRecord,
  replayed: boolean,
  participantIdentity?: string,
) {
  return {
    callId: record.callId,
    sessionId: record.sessionId,
    roomName: record.roomName,
    operationId: operation.id,
    provider: operation.provider,
    status: operation.status,
    replayed,
    ...(participantIdentity ? { participantIdentity } : {}),
    ...(operation.externalOperationId
      ? { providerCallId: operation.externalOperationId }
      : {}),
  };
}

function sendValidationError(
  reply: Parameters<typeof sendError>[0],
  result: Exclude<DialValidation, { ok: true }>,
) {
  return sendError(reply, result.status, result.code, result.message);
}

function failure(
  status: 403 | 404 | 409 | 410,
  code: string,
  message: string,
): Exclude<DialValidation, { ok: true }> {
  return { ok: false, status, code, message };
}

function failUnansweredCall(record: CallLinkRecord) {
  return withSessionWriteLock(record.callId, async () => {
    const session = await completeSessionWithUsage(
      record.sessionId,
      { billableSeconds: 0 },
    );
    if (session?.endedAt) await endCallLegs(session.id, session.endedAt);
    return session;
  });
}
