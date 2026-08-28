import { createHash } from "node:crypto";
import {
  encodeTranslationCallControl,
  parseTranslationCallControl,
  type TranslationCallControlCommand,
} from "@translation/contracts";
import {
  claimPendingOutboxEvents,
  markOutboxFailed,
  markOutboxPublishedByIdempotencyKey,
  pendingOutboxSessionIds,
  type ClaimedOutboxEvent,
} from "../events/reliable-events-runtime.repository.js";
import {
  findActiveProviderOperations,
  findProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { withSessionWriteLock } from
  "../sessions/session-write-coordinator.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { getLiveKitRoomConfig } from "./call-room-readiness.js";
import {
  findCallLinkTranslationState,
} from "./call-link-translation-state.repository.js";
import {
  findTranslationDialOperation,
  parseTranslationControlOperationKey,
} from "./call-link-translation-control-support.js";
import { findCallLink } from "./call-links.service.js";
import {
  acceptTranslationControlForDelivery,
  failTranslationControlCommand,
  reconcileTerminalTranslationControl,
} from "./translation-call-control-reconciliation.js";
import {
  TranslationCallControlPublisher,
  TranslationControlWorkerBindingError,
} from "./translation-call-control-publisher.js";

const eventType = "translation_call_control.delivery";
const deliveryRetryLimit = 12;
type ControlPublisher = Pick<TranslationCallControlPublisher, "publish">;
let testPublisher: ControlPublisher | null = null;

export function setTranslationCallControlPublisherForTests(
  publisher: ControlPublisher | null,
) {
  testPublisher = publisher;
}

export function translationControlDeliveryKey(operationId: string) {
  return `translation-control-delivery:${operationId}`;
}

export function translationControlDeliveryOutbox(input: {
  sessionId: string;
  roomName: string;
  command: TranslationCallControlCommand;
}) {
  const idempotencyKey = translationControlDeliveryKey(
    input.command.controlOperationId,
  );
  return {
    id: `outbox_${createHash("sha256").update(idempotencyKey).digest("hex")}`,
    idempotencyKey,
    sessionId: input.sessionId,
    eventType,
    eventVersion: 1 as const,
    payload: { roomName: input.roomName, command: input.command },
  };
}

export function completeTranslationControlDelivery(operationId: string) {
  return markOutboxPublishedByIdempotencyKey(
    translationControlDeliveryKey(operationId),
  );
}

export async function deliverPendingTranslationControls(
  sessionId: string,
  now = new Date(),
) {
  return withSessionWriteLock(sessionId, () =>
    deliverClaimedTranslationControls(sessionId, now));
}

async function deliverClaimedTranslationControls(
  sessionId: string,
  now: Date,
) {
  const records = await claimPendingOutboxEvents({
    sessionId,
    eventType,
    now,
    limit: 32,
  });
  const result = { delivered: 0, waiting: 0, completed: 0, failed: 0 };
  for (const record of records) {
    const payload = parsePayload(record.payload);
    if (!payload) {
      await completeRecord(record);
      result.failed += 1;
      continue;
    }
    const admission = await deliveryAdmission(
      sessionId,
      payload.roomName,
      payload.command,
      now,
    );
    if (admission === "complete") {
      if (await reconcileTerminalTranslationControl(payload.command)) {
        await completeRecord(record);
        result.completed += 1;
      } else {
        await scheduleRetry(record, "terminal_reconciliation_pending");
        result.waiting += 1;
      }
      continue;
    }
    if (record.attempts >= deliveryRetryLimit &&
      (admission === "deliver" || admission === "wait")) {
      if (await failTranslationControlCommand(
        payload.command,
        "delivery_retry_exhausted",
      )) {
        await completeRecord(record);
        result.failed += 1;
      } else {
        await scheduleRetry(record, "failure_reconciliation_pending");
        result.waiting += 1;
      }
      continue;
    }
    if (admission !== "deliver") {
      if (admission === "wait") {
        await scheduleRetry(record, "binding_not_ready");
        result.waiting += 1;
      } else {
        if (await failTranslationControlCommand(payload.command, admission)) {
          await completeRecord(record);
          result.failed += 1;
        } else {
          await scheduleRetry(record, "failure_reconciliation_pending");
          result.waiting += 1;
        }
      }
      continue;
    }
    if (!await acceptTranslationControlForDelivery(payload.command)) {
      await scheduleRetry(record, "operation_accept_pending");
      result.waiting += 1;
      continue;
    }
    await scheduleRetry(record, "awaiting_worker_ack");
    const config = getLiveKitRoomConfig();
    if (!config.ok) {
      await markOperationUnknown(payload.command, "livekit_not_ready");
      result.waiting += 1;
      continue;
    }
    try {
      const publisher = testPublisher ??
        new TranslationCallControlPublisher(config.config);
      await publisher.publish(payload.roomName, payload.command);
      result.delivered += 1;
    } catch (error) {
      if (error instanceof TranslationControlWorkerBindingError &&
        error.workerCount > 1) {
        if (await failTranslationControlCommand(
          payload.command,
          "worker_binding_conflict",
        )) {
          await completeTranslationControlDelivery(
            payload.command.controlOperationId,
          );
          result.failed += 1;
        } else {
          await scheduleRetry(record, "failure_reconciliation_pending");
          result.waiting += 1;
        }
      } else {
        await markOperationUnknown(payload.command, "delivery_unknown");
        result.waiting += 1;
      }
    }
  }
  return result;
}

export async function recoverPendingTranslationControls(now = new Date()) {
  const totals = { sessions: 0, delivered: 0, waiting: 0, completed: 0,
    failed: 0 };
  for (const sessionId of await pendingOutboxSessionIds(eventType, now)) {
    const result = await deliverPendingTranslationControls(sessionId, now);
    totals.sessions += 1;
    totals.delivered += result.delivered;
    totals.waiting += result.waiting;
    totals.completed += result.completed;
    totals.failed += result.failed;
  }
  totals.failed += await expireTypeToSpeakClaims(now);
  return totals;
}

async function expireTypeToSpeakClaims(now: Date) {
  const candidates = await findActiveProviderOperations(
    "translation_type_to_speak",
  );
  let failed = 0;
  for (const candidate of candidates) {
    if (Date.parse(candidate.startedAt) + 120_000 > now.getTime()) continue;
    await withSessionWriteLock(candidate.sessionId, async () => {
      const current = await findProviderOperation(candidate.id);
      if (!current || ["succeeded", "failed", "cancelled"].includes(
        current.status,
      ) || Date.parse(current.startedAt) + 120_000 > now.getTime()) return;
      const result = await updateProviderOperation({
        operationId: current.id,
        status: "failed",
        expectedVersion: current.version,
        errorClass: "translation_control_expired",
      });
      if (result.status === "updated" || result.status === "terminal") {
        await completeTranslationControlDelivery(current.id);
        failed += 1;
      }
    });
  }
  return failed;
}

export function startTranslationControlRecovery(input: {
  intervalSeconds: number;
  onResult?: (result: Awaited<ReturnType<
    typeof recoverPendingTranslationControls
  >>) => void;
  onError?: (error: unknown) => void;
}) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void recoverPendingTranslationControls()
      .then((result) => input.onResult?.(result))
      .catch((error) => input.onError?.(error))
      .finally(() => { running = false; });
  }, Math.max(1, input.intervalSeconds) * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

async function deliveryAdmission(
  sessionId: string,
  roomName: string,
  command: TranslationCallControlCommand,
  now: Date,
) {
  const operation = await findProviderOperation(command.controlOperationId);
  if (!operation || operation.sessionId !== sessionId ||
    operation.operationType !== operationType(command)) {
    return "operation_binding_conflict";
  }
  const operationBinding = parseTranslationControlOperationKey(
    operation.operationKey,
  );
  if (!operationBinding ||
    operationBinding.controlGeneration !== command.controlGeneration ||
    operationBinding.dispatchGeneration !== command.dispatchGeneration) {
    return "operation_binding_conflict";
  }
  if (["succeeded", "failed", "cancelled"].includes(operation.status)) {
    return "complete";
  }
  if (Date.parse(command.expiresAt) <= now.getTime()) return "control_expired";
  const call = await findCallLink(command.callId);
  if (!call || call.sessionId !== sessionId || call.roomName !== roomName ||
    call.status === "ended" || Date.parse(call.expiresAt) <= now.getTime()) {
    return "call_binding_conflict";
  }
  const [dial, dispatch, state] = await Promise.all([
    findTranslationDialOperation(sessionId),
    findWorkerDispatch(sessionId),
    findCallLinkTranslationState(sessionId),
  ]);
  if (!dial || dial.id !== command.dialOperationId || !state) {
    return "control_binding_conflict";
  }
  if (!dispatch || dispatch.generation !== command.dispatchGeneration ||
    dispatch.status !== "ready" ||
    Date.parse(dispatch.leaseExpiresAt) <= now.getTime()) return "wait";
  if (command.type === "translation.type_to_speak") {
    return state.controlGeneration === command.controlGeneration &&
        !state.uplinkPaused && !state.pending
      ? "deliver" : "stale_control_generation";
  }
  if (state.pending?.operationId === command.controlOperationId &&
    state.pending.controlGeneration === command.controlGeneration &&
    state.pending.dispatchGeneration === command.dispatchGeneration) {
    return "deliver";
  }
  return state.lastSettledOperationId === command.controlOperationId &&
      state.lastSettledControlGeneration === command.controlGeneration &&
      state.lastSettledDispatchGeneration === command.dispatchGeneration
    ? "complete" : "stale_control_generation";
}

async function markOperationUnknown(
  command: TranslationCallControlCommand,
  errorClass: string,
) {
  const operation = await findProviderOperation(command.controlOperationId);
  if (!operation || !["in_flight", "accepted"].includes(operation.status)) {
    return;
  }
  await updateProviderOperation({
    operationId: operation.id,
    status: "unknown",
    expectedVersion: operation.version,
    errorClass,
  });
}

function scheduleRetry(record: ClaimedOutboxEvent, reason: string) {
  return markOutboxFailed(record, new Error(reason));
}

function completeRecord(record: ClaimedOutboxEvent) {
  return markOutboxPublishedByIdempotencyKey(record.idempotencyKey);
}

function parsePayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.roomName !== "string" || !input.command) return null;
  const command = parseTranslationCallControl(
    encodeTranslationCallControl(input.command as TranslationCallControlCommand),
  );
  return command ? { roomName: input.roomName, command } : null;
}

function operationType(command: TranslationCallControlCommand) {
  return command.type === "translation.type_to_speak"
    ? "translation_type_to_speak" : "translation_uplink_control";
}
