import type { TranslationCallControlCommand } from "@translation/contracts";
import {
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import {
  beginCallLinkUplinkControl,
  findCallLinkTranslationState,
  settleCallLinkUplinkControl,
} from "./call-link-translation-state.repository.js";

export async function failTranslationControlCommand(
  command: TranslationCallControlCommand,
  errorClass: string,
) {
  const operation = await findProviderOperation(command.controlOperationId);
  if (!operation) return true;
  if (!terminal(operation.status)) {
    const updated = await updateProviderOperation({
      operationId: operation.id,
      status: "failed",
      expectedVersion: operation.version,
      errorClass,
    });
    if (updated.status !== "updated" && updated.status !== "terminal") {
      const current = await findProviderOperation(operation.id);
      if (!current || !terminal(current.status)) return false;
    }
  }
  return reconcileTerminalTranslationControl(command);
}

export async function acceptTranslationControlForDelivery(
  command: TranslationCallControlCommand,
) {
  const operation = await findProviderOperation(command.controlOperationId);
  if (!operation) return false;
  if (["accepted", "active"].includes(operation.status)) return true;
  if (!["in_flight", "unknown"].includes(operation.status)) return false;
  const result = await updateProviderOperation({
    operationId: operation.id,
    status: "accepted",
    expectedVersion: operation.version,
  });
  if (result.status === "updated") return result.operation.status === "accepted";
  const current = await findProviderOperation(operation.id);
  return current?.status === "accepted" || current?.status === "active";
}

export async function reconcileTerminalTranslationControl(
  command: TranslationCallControlCommand,
) {
  const operation = await findProviderOperation(command.controlOperationId);
  if (!operation) return true;
  if (command.type !== "translation.uplink_pause") {
    return terminal(operation.status);
  }
  const state = await findCallLinkTranslationState(operation.sessionId);
  if (!state) return terminal(operation.status);
  const stateSettled = state?.lastSettledOperationId === operation.id &&
    state.lastSettledControlGeneration === command.controlGeneration &&
    state.lastSettledDispatchGeneration === command.dispatchGeneration;
  if (stateSettled) {
    if (!terminal(operation.status)) {
      await updateProviderOperation({
        operationId: operation.id,
        status: state.lastSettledSucceeded ? "succeeded" : "failed",
        expectedVersion: operation.version,
        ...(!state.lastSettledSucceeded
          ? { errorClass: "worker_control_failed" } : {}),
      });
    }
    const current = await findProviderOperation(operation.id);
    return Boolean(current && terminal(current.status) &&
      (current.status === "succeeded") === state.lastSettledSucceeded);
  }
  if (!terminal(operation.status)) return false;
  if (state.controlGeneration > command.controlGeneration) return true;
  if (state.controlGeneration < command.controlGeneration) {
    if (state.pending ||
      state.controlGeneration + 1 !== command.controlGeneration ||
      operation.status === "succeeded") return false;
    const begun = await beginCallLinkUplinkControl({
      sessionId: operation.sessionId,
      operationId: operation.id,
      idempotencyKey: operation.idempotencyKey,
      paused: command.paused,
      dispatchGeneration: command.dispatchGeneration,
      controlGeneration: command.controlGeneration,
    });
    if (!begun || !["updated", "replayed"].includes(begun.status)) return false;
    const settled = await settleCallLinkUplinkControl({
      sessionId: operation.sessionId,
      operationId: operation.id,
      controlGeneration: command.controlGeneration,
      dispatchGeneration: command.dispatchGeneration,
      succeeded: false,
    });
    return Boolean(settled && settled.status !== "binding_conflict");
  }
  const pending = state.pending;
  if (!pending) return operation.status !== "succeeded";
  if (pending.operationId !== operation.id ||
    pending.controlGeneration !== command.controlGeneration ||
    pending.dispatchGeneration !== command.dispatchGeneration) return false;
  const settled = await settleCallLinkUplinkControl({
    sessionId: operation.sessionId,
    operationId: operation.id,
    controlGeneration: command.controlGeneration,
    dispatchGeneration: command.dispatchGeneration,
    succeeded: operation.status === "succeeded",
  });
  return Boolean(settled && settled.status !== "binding_conflict");
}

function terminal(status: string) {
  return ["succeeded", "failed", "cancelled"].includes(status);
}
