import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  findProviderOperationByIdempotency,
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { withSessionWriteLock } from
  "../sessions/session-write-coordinator.js";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";
import {
  beginCallLinkUplinkControl,
  findCallLinkTranslationState,
} from "./call-link-translation-state.repository.js";
import {
  controlFailure,
  parseTranslationTypeToSpeak,
  parseTranslationUplinkControl,
  parseTranslationControlOperationKey,
  resolveTranslationControlBinding,
  translationControlHash,
  translationControlOperationKey,
  translationControlResponse,
  translationUplinkControlOperationKey,
} from "./call-link-translation-control-support.js";
import { registerCallLinkTranslationControlStatusRoutes } from
  "./call-link-translation-control-status.routes.js";
import {
  translationControlOperationIdempotencyKey,
  translationControlOutboxFactory,
} from "./call-link-translation-control-command.js";
import {
  deliverPendingTranslationControls,
  setTranslationCallControlPublisherForTests,
} from "./translation-call-control-outbox.js";

export { setTranslationCallControlPublisherForTests };

export function registerCallLinkTranslationControlRoutes(app: FastifyInstance) {
  app.post("/call-links/:callId/type-to-speak", handleTypeToSpeak);
  app.post("/call-links/:callId/translation-uplink", handleUplinkControl);
  registerCallLinkTranslationControlStatusRoutes(app);
}

async function handleTypeToSpeak(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const account = await requireAccount(request, reply);
  if (!account) return;
  const callId = (request.params as { callId: string }).callId;
  const body = parseTranslationTypeToSpeak(request.body);
  if (!body) return sendError(reply, 400, "invalid_type_to_speak", "Invalid text");
  const config = getLiveKitRoomConfig();
  if (!config.ok) return notReady(reply);
  const started = await withSessionWriteLock(callId, async () => {
    const binding = await resolveTranslationControlBinding(callId, account.id);
    if (!binding.ok) return binding;
    const providerIdempotencyKey = translationControlOperationIdempotencyKey({
      type: "translation.type_to_speak",
      sessionId: binding.record.sessionId,
      idempotencyKey: body.idempotencyKey,
    });
    const existing = await findProviderOperationByIdempotency(
      "livekit",
      "translation_type_to_speak",
      providerIdempotencyKey,
    );
    if (!existing && (binding.state.uplinkPaused || binding.state.pending)) {
      return controlFailure(409, "translation_uplink_paused",
        "Translated uplink is paused");
    }
    const operationBinding = existing
      ? parseTranslationControlOperationKey(existing.operationKey)
      : {
          controlGeneration: binding.state.controlGeneration,
          dispatchGeneration: binding.dispatch.generation,
        };
    if (!operationBinding) {
      return controlFailure(409, "translation_control_operation_conflict",
        "Translation control conflicts");
    }
    const requestHash = translationControlHash({
      dialOperationId: binding.dial.id,
      text: body.text,
      sourceLanguage: binding.state.sourceLanguage,
      targetLanguage: binding.state.targetLanguage,
      controlGeneration: operationBinding.controlGeneration,
      dispatchGeneration: operationBinding.dispatchGeneration,
    });
    if (existing && existing.requestHash !== requestHash) {
      return controlFailure(409, "translation_control_operation_conflict",
        "Translation control conflicts");
    }
    const result = await beginProviderOperation({
      sessionId: binding.record.sessionId,
      provider: "livekit",
      operationType: "translation_type_to_speak",
      operationKey: translationControlOperationKey(
        body.idempotencyKey,
        operationBinding.controlGeneration,
        operationBinding.dispatchGeneration,
      ),
      idempotencyKey: providerIdempotencyKey,
      requestHash,
      outboxFactory: translationControlOutboxFactory({
        sessionId: binding.record.sessionId,
        roomName: binding.record.roomName,
        callId,
        dialOperationId: binding.dial.id,
        dispatchGeneration: operationBinding.dispatchGeneration,
        controlGeneration: operationBinding.controlGeneration,
        command: {
          type: "translation.type_to_speak",
          text: body.text,
          state: binding.state,
        },
      }),
    });
    if (result.status === "payload_conflict" ||
      result.status === "session_conflict") {
      return controlFailure(409, "translation_control_operation_conflict",
        "Translation control conflicts");
    }
    return { ok: true as const, binding, operation: result.operation,
      replayed: result.status === "replayed" };
  });
  if (!started.ok) return validationError(reply, started);
  const operation = started.operation.status === "in_flight"
    ? await acceptOperation(started.operation) : started.operation;
  const controlBinding = parseTranslationControlOperationKey(
    operation.operationKey,
  );
  if (!controlBinding) {
    return sendError(reply, 409, "translation_control_binding_conflict",
      "Translation control binding changed");
  }
  await deliverPendingTranslationControls(operation.sessionId);
  const current = await findProviderOperation(operation.id) ?? operation;
  const state = await findCallLinkTranslationState(operation.sessionId) ??
    started.binding.state;
  return reply.status(202).send(translationControlResponse(
    callId, current, started.replayed,
    controlBinding.controlGeneration, state.uplinkPaused,
  ));
}

async function handleUplinkControl(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const account = await requireAccount(request, reply);
  if (!account) return;
  const callId = (request.params as { callId: string }).callId;
  const body = parseTranslationUplinkControl(request.body);
  if (!body) return sendError(reply, 400, "invalid_translation_uplink_control",
    "Invalid translation uplink control");
  const config = getLiveKitRoomConfig();
  if (!config.ok) return notReady(reply);
  const prepared = await withSessionWriteLock(callId, async () => {
    const binding = await resolveTranslationControlBinding(callId, account.id);
    if (!binding.ok) return binding;
    if (binding.state.pending &&
      binding.state.pending.idempotencyKey !== body.idempotencyKey) {
      return controlFailure(409, "translation_control_pending",
        "A translation control is still pending");
    }
    const providerIdempotencyKey = translationControlOperationIdempotencyKey({
      type: "translation.uplink_pause",
      sessionId: binding.record.sessionId,
      idempotencyKey: body.idempotencyKey,
    });
    const requestHash = translationControlHash({
      dialOperationId: binding.dial.id,
      paused: body.paused,
    });
    const existing = await findProviderOperationByIdempotency(
      "livekit",
      "translation_uplink_control",
      providerIdempotencyKey,
    );
    if (existing && existing.requestHash !== requestHash) {
      return controlFailure(409, "translation_control_operation_conflict",
        "Translation control conflicts");
    }
    const existingBinding = existing
      ? parseTranslationControlOperationKey(existing.operationKey) : null;
    if (existing && !existingBinding) {
      return controlFailure(409, "translation_control_operation_conflict",
        "Translation control conflicts");
    }
    const operationBinding = existingBinding ?? {
      controlGeneration: binding.state.controlGeneration + 1,
      dispatchGeneration: binding.dispatch.generation,
    };
    const begun = await beginProviderOperation({
      sessionId: binding.record.sessionId,
      provider: "livekit",
      operationType: "translation_uplink_control",
      operationKey: translationUplinkControlOperationKey(
        operationBinding.controlGeneration,
        operationBinding.dispatchGeneration,
      ),
      idempotencyKey: providerIdempotencyKey,
      requestHash,
      outboxFactory: translationControlOutboxFactory({
        sessionId: binding.record.sessionId,
        roomName: binding.record.roomName,
        callId,
        dialOperationId: binding.dial.id,
        dispatchGeneration: operationBinding.dispatchGeneration,
        controlGeneration: operationBinding.controlGeneration,
        command: {
          type: "translation.uplink_pause",
          paused: body.paused,
        },
      }),
    });
    if (begun.status === "payload_conflict") {
      return controlFailure(409, "translation_control_operation_conflict",
        "Translation control conflicts");
    }
    if (begun.status === "session_conflict") {
      return controlFailure(409, "translation_control_pending",
        "A translation control is still pending");
    }
    if (begun.status === "replayed") {
      const pending = binding.state.pending?.operationId === begun.operation.id
        ? binding.state.pending : undefined;
      if (pending) return { ok: true as const, binding,
        operation: begun.operation, state: binding.state, replayed: true,
        control: pending };
      if (binding.state.lastSettledOperationId === begun.operation.id) {
        return { ok: true as const, binding, operation: begun.operation,
          state: binding.state, replayed: true, control: undefined };
      }
      if (["failed", "cancelled"].includes(begun.operation.status)) {
        return { ok: true as const, binding, operation: begun.operation,
          state: binding.state, replayed: true, control: undefined };
      }
      const recovered = parseTranslationControlOperationKey(
        begun.operation.operationKey,
      );
      if (begun.operation.status !== "in_flight" || !recovered ||
        recovered.controlGeneration !== binding.state.controlGeneration + 1 ||
        recovered.dispatchGeneration !== binding.dispatch.generation) {
        return controlFailure(409, "translation_control_state_conflict",
          "Translation control state conflicts");
      }
      const recoveredState = await beginCallLinkUplinkControl({
        sessionId: binding.record.sessionId,
        operationId: begun.operation.id,
        idempotencyKey: body.idempotencyKey,
        paused: body.paused,
        dispatchGeneration: recovered.dispatchGeneration,
        controlGeneration: recovered.controlGeneration,
      });
      if (!recoveredState || recoveredState.status !== "updated") {
        return controlFailure(409, "translation_control_state_conflict",
          "Translation control state conflicts");
      }
      return { ok: true as const, binding, operation: begun.operation,
        state: recoveredState.state, replayed: true,
        control: recoveredState.state.pending };
    }
    const begunBinding = parseTranslationControlOperationKey(
      begun.operation.operationKey,
    );
    if (!begunBinding) {
      return controlFailure(409, "translation_control_state_conflict",
        "Translation control state conflicts");
    }
    const stateResult = await beginCallLinkUplinkControl({
      sessionId: binding.record.sessionId,
      operationId: begun.operation.id,
      idempotencyKey: body.idempotencyKey,
      paused: body.paused,
      dispatchGeneration: begunBinding.dispatchGeneration,
      controlGeneration: begunBinding.controlGeneration,
    });
    if (!stateResult || stateResult.status === "not_found" ||
      stateResult.status === "pending_conflict" ||
      stateResult.status === "generation_conflict") {
      return controlFailure(409, "translation_control_state_conflict",
        "Translation control state conflicts");
    }
    return { ok: true as const, binding, operation: begun.operation,
      state: stateResult.state, replayed: false,
      control: stateResult.state.pending };
  });
  if (!prepared.ok) return validationError(reply, prepared);
  if (!prepared.control) return reply.status(202).send(
    translationControlResponse(callId, prepared.operation, true,
      prepared.state.controlGeneration, prepared.state.uplinkPaused),
  );
  const control = prepared.control!;
  const operation = prepared.operation.status === "in_flight"
    ? await acceptOperation(prepared.operation) : prepared.operation;
  await deliverPendingTranslationControls(operation.sessionId);
  const current = await findProviderOperation(operation.id) ?? operation;
  const state = await findCallLinkTranslationState(operation.sessionId) ??
    prepared.state;
  return reply.status(202).send(translationControlResponse(
    callId, current, prepared.replayed,
    state.controlGeneration, state.uplinkPaused,
  ));
}

async function acceptOperation(operation: Parameters<
  typeof translationControlResponse
>[1]) {
  const result = await updateProviderOperation({
    operationId: operation.id,
    status: "accepted",
    expectedVersion: operation.version,
  });
  return "operation" in result && result.operation
    ? result.operation : operation;
}

function validationError(
  reply: FastifyReply,
  result: { status: 403 | 404 | 409 | 410; code: string; message: string },
) {
  return sendError(reply, result.status, result.code, result.message);
}

function notReady(reply: FastifyReply) {
  return sendError(reply, 503, "call_room_provider_not_configured",
    "Call room provider is not configured");
}
