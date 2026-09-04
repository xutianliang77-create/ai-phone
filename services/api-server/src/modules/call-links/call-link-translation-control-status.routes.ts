import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { withSessionWriteLock } from
  "../sessions/session-write-coordinator.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { isInternalAuthorized } from "./call-link-internal.routes.js";
import {
  findCallLinkTranslationState,
  prepareCallLinkUplinkResume,
  settleCallLinkUplinkControl,
} from "./call-link-translation-state.repository.js";
import {
  findTranslationDialOperation,
  parseTranslationControlOperationKey,
  parseTranslationControlStatus,
  translationControlResponse,
} from "./call-link-translation-control-support.js";
import { findCallLink } from "./call-links.service.js";
import { completeTranslationControlDelivery } from
  "./translation-call-control-outbox.js";

export function registerCallLinkTranslationControlStatusRoutes(
  app: FastifyInstance,
) {
  app.get(
    "/call-links/:callId/translation-controls/:operationId",
    handleControlStatus,
  );
  app.post(
    "/internal/call-links/:callId/translation-controls/:operationId/status",
    handleWorkerStatus,
  );
}

async function handleControlStatus(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const account = await requireAccount(request, reply);
  if (!account) return;
  const params = request.params as { callId: string; operationId: string };
  const call = await findCallLink(params.callId);
  if (!call) {
    return sendError(reply, 404, "call_link_not_found", "Call link not found");
  }
  if (call.userId !== account.id) {
    return sendError(reply, 403, "account_forbidden",
      "Account cannot access this call");
  }
  const operation = await findProviderOperation(params.operationId);
  if (!translationOperationMatches(operation, call.sessionId)) {
    return sendError(reply, 404, "translation_control_not_found",
      "Translation control was not found");
  }
  const state = await findCallLinkTranslationState(call.sessionId);
  if (!state) {
    return sendError(reply, 409, "translation_control_not_configured",
      "Translation is not configured");
  }
  return translationControlResponse(call.callId, operation, false,
    state.controlGeneration, state.uplinkPaused);
}

async function handleWorkerStatus(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!isInternalAuthorized(request.headers.authorization)) {
    return sendError(reply, 401, "internal_error",
      "Unauthorized internal request");
  }
  const params = request.params as { callId: string; operationId: string };
  const body = parseTranslationControlStatus(request.body);
  if (!body) {
    return sendError(reply, 400, "invalid_translation_control_status",
      "Invalid translation control status");
  }
  return withSessionWriteLock(params.callId, async () => {
    const call = await findCallLink(params.callId);
    const operation = await findProviderOperation(params.operationId);
    const actualDial = call
      ? await findTranslationDialOperation(call.sessionId) : null;
    const dispatch = call ? await findWorkerDispatch(call.sessionId) : null;
    if (!call || !translationOperationMatches(operation, call.sessionId)) {
      return sendError(reply, 409, "translation_control_binding_conflict",
        "Translation control binding failed");
    }
    const operationBinding = parseTranslationControlOperationKey(
      operation.operationKey,
    );
    if (call.status === "ended" || Date.parse(call.expiresAt) <= Date.now() ||
      !actualDial || actualDial.id !== body.dialOperationId ||
      !dispatch || dispatch.status !== "ready" ||
      dispatch.generation !== body.dispatchGeneration ||
      Date.parse(dispatch.leaseExpiresAt) <= Date.now() ||
      !operationBinding ||
      operationBinding.controlGeneration !== body.controlGeneration ||
      operationBinding.dispatchGeneration !== body.dispatchGeneration) {
      return sendError(reply, 409, "translation_control_binding_conflict",
        "Translation control binding failed");
    }
    if (body.status === "prepared") {
      if (operation.operationType === "translation_type_to_speak") {
        return prepareTypeToSpeak(reply, call.callId, operation, body);
      }
      const prepared = await prepareCallLinkUplinkResume({
        sessionId: operation.sessionId,
        operationId: operation.id,
        controlGeneration: body.controlGeneration,
        dispatchGeneration: body.dispatchGeneration,
      });
      if (!prepared || prepared.status === "binding_conflict") {
        return sendError(reply, 409,
          "translation_control_generation_conflict",
          "Translation control generation is stale");
      }
      return translationControlResponse(call.callId, operation,
        prepared.status === "replayed", body.controlGeneration,
        prepared.state.uplinkPaused);
    }
    if (finalControlStatus(operation.status) &&
      operation.status !== body.status) {
      return sendError(reply, 409,
        "translation_control_terminal_conflict",
        "Translation control already has a different result");
    }
    if (!await settleControl(operation, body)) {
      return sendError(reply, 409, "translation_control_generation_conflict",
        "Translation control generation is stale");
    }
    const replayed = operation.status === body.status;
    if (!finalControlStatus(operation.status)) {
      await updateProviderOperation({
        operationId: operation.id,
        status: body.status,
        expectedVersion: operation.version,
        errorClass: body.errorClass,
      });
    }
    const current = await findProviderOperation(operation.id) ?? operation;
    if (current.status !== body.status) {
      return sendError(reply, 409,
        "translation_control_terminal_conflict",
        "Translation control already has a different result");
    }
    await completeTranslationControlDelivery(operation.id);
    const state = await findCallLinkTranslationState(call.sessionId);
    return translationControlResponse(call.callId, current, replayed,
      body.controlGeneration,
      state?.uplinkPaused ?? true);
  });
}

async function prepareTypeToSpeak(
  reply: FastifyReply,
  callId: string,
  operation: NonNullable<Awaited<ReturnType<typeof findProviderOperation>>>,
  body: NonNullable<ReturnType<typeof parseTranslationControlStatus>>,
) {
  if (finalControlStatus(operation.status)) {
    return sendError(reply, 409, "translation_control_terminal_conflict",
      "Translation control already has a final result");
  }
  const replayed = operation.status === "active";
  if (!replayed) {
    if (operation.status !== "accepted") {
      return sendError(reply, 409, "translation_control_terminal_conflict",
        "Translation control execution claim is not deliverable");
    }
    await updateProviderOperation({
      operationId: operation.id,
      status: "active",
      expectedVersion: operation.version,
    });
  }
  const current = await findProviderOperation(operation.id) ?? operation;
  if (current.status !== "active") {
    return sendError(reply, 409, "translation_control_terminal_conflict",
      "Translation control execution claim failed");
  }
  if (!await completeTranslationControlDelivery(operation.id)) {
    return sendError(reply, 409, "translation_control_terminal_conflict",
      "Translation control execution claim is not durable");
  }
  const state = await findCallLinkTranslationState(operation.sessionId);
  return translationControlResponse(callId, current, replayed,
    body.controlGeneration, state?.uplinkPaused ?? true);
}

async function settleControl(
  operation: NonNullable<Awaited<ReturnType<typeof findProviderOperation>>>,
  body: NonNullable<ReturnType<typeof parseTranslationControlStatus>>,
) {
  if (body.status === "prepared") return false;
  if (operation.operationType === "translation_uplink_control") {
    const settled = await settleCallLinkUplinkControl({
      sessionId: operation.sessionId,
      operationId: operation.id,
      controlGeneration: body.controlGeneration,
      dispatchGeneration: body.dispatchGeneration,
      succeeded: body.status === "succeeded",
    });
    return Boolean(settled && settled.status !== "binding_conflict");
  }
  if (finalControlStatus(operation.status)) {
    return operation.status === body.status;
  }
  if (operation.status !== "active" &&
    !(operation.status === "accepted" && body.status === "failed")) {
    return false;
  }
  const state = await findCallLinkTranslationState(operation.sessionId);
  return Boolean(state && state.controlGeneration >= body.controlGeneration);
}

function translationOperationMatches(
  operation: Awaited<ReturnType<typeof findProviderOperation>>,
  sessionId: string,
): operation is NonNullable<typeof operation> {
  return Boolean(operation && operation.sessionId === sessionId &&
    ["translation_type_to_speak", "translation_uplink_control"]
      .includes(operation.operationType));
}

function finalControlStatus(status: string) {
  return ["succeeded", "failed", "cancelled"].includes(status);
}
