import { findSession, mutateSessionRecord } from
  "../sessions/sessions-runtime.repository.js";
import type { SessionRecord } from "../sessions/session-record.js";
import type { CallLinkTranslationControlState } from
  "./call-link-record.js";
import type { CallLinkDiagnosticMarker } from "./call-link-record.js";
import { mutateLegacyCallLinkTranslationState } from
  "./call-link-translation-state-legacy.repository.js";

type BeginUplinkControlResult =
  | { status: "not_found" }
  | {
      status: "replayed" | "pending_conflict" | "generation_conflict" | "updated";
      state: CallLinkTranslationControlState;
    };

type SettleUplinkControlResult =
  | { status: "binding_conflict" }
  | {
      status: "replayed" | "updated";
      state: CallLinkTranslationControlState;
    };

type DiagnosticMarkerResult =
  | { status: "not_found" }
  | {
      status: "replayed" | "payload_conflict" | "recorded";
      marker: CallLinkDiagnosticMarker;
    };

export function configureCallLinkTranslationState(input: {
  sessionId: string;
  sourceLanguage: "zh" | "en";
  targetLanguage: "zh" | "en";
  now?: Date;
}) {
  return mutate(input.sessionId, "translation-configure", input, (current) => {
    const existing = current.callLink?.translationControl;
    if (existing) {
      return existing.sourceLanguage === input.sourceLanguage &&
          existing.targetLanguage === input.targetLanguage
        ? { next: null, result: existing }
        : { next: null, result: null };
    }
    if (!current.callLink || current.callLink.purpose === "voice_agent") {
      return { next: null, result: null };
    }
    const state: CallLinkTranslationControlState = {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      uplinkPaused: false,
      controlGeneration: 1,
      updatedAt: (input.now ?? new Date()).toISOString(),
    };
    const next = structuredClone(current);
    next.callLink!.translationControl = state;
    return { next, result: state };
  });
}

export function beginCallLinkUplinkControl(input: {
  sessionId: string;
  operationId: string;
  idempotencyKey: string;
  paused: boolean;
  dispatchGeneration: number;
  controlGeneration?: number;
  now?: Date;
}) {
  return mutate<BeginUplinkControlResult>(
    input.sessionId,
    "translation-uplink-request",
    input,
    (current) => {
      const state = current.callLink?.translationControl;
      if (!state) {
        return { next: null, result: { status: "not_found" as const } };
      }
      if (state.pending?.operationId === input.operationId) {
        const matches = state.pending.idempotencyKey === input.idempotencyKey &&
          state.pending.requestedPaused === input.paused &&
          state.pending.dispatchGeneration === input.dispatchGeneration &&
          (input.controlGeneration === undefined ||
            state.pending.controlGeneration === input.controlGeneration);
        return matches
          ? { next: null, result: { status: "replayed" as const, state } }
          : {
              next: null,
              result: { status: "pending_conflict" as const, state },
            };
      }
      if (state.pending) {
        return {
          next: null,
          result: { status: "pending_conflict" as const, state },
        };
      }
      const next = structuredClone(current);
      const currentState = next.callLink!.translationControl!;
      const generation = currentState.controlGeneration + 1;
      if (input.controlGeneration !== undefined &&
        input.controlGeneration !== generation) {
        return {
          next: null,
          result: { status: "generation_conflict" as const, state },
        };
      }
      currentState.controlGeneration = generation;
      currentState.uplinkPaused = input.paused || currentState.uplinkPaused;
      currentState.pending = {
        operationId: input.operationId,
        idempotencyKey: input.idempotencyKey,
        requestedPaused: input.paused,
        controlGeneration: generation,
        dispatchGeneration: input.dispatchGeneration,
      };
      currentState.updatedAt = (input.now ?? new Date()).toISOString();
      return {
        next,
        result: (saved: SessionRecord) => ({
          status: "updated" as const,
          state: saved.callLink!.translationControl!,
        }),
      };
    },
  );
}

export function settleCallLinkUplinkControl(input: {
  sessionId: string;
  operationId: string;
  controlGeneration: number;
  dispatchGeneration: number;
  succeeded: boolean;
  now?: Date;
}) {
  return mutate<SettleUplinkControlResult>(
    input.sessionId,
    "translation-uplink-settle",
    input,
    (current) => {
      const state = current.callLink?.translationControl;
      const pending = state?.pending;
      if (state && !pending &&
        state.lastSettledOperationId === input.operationId &&
        state.lastSettledControlGeneration === input.controlGeneration &&
        state.lastSettledDispatchGeneration === input.dispatchGeneration) {
        return state.lastSettledSucceeded === input.succeeded
          ? { next: null, result: { status: "replayed" as const, state } }
          : {
              next: null,
              result: { status: "binding_conflict" as const },
            };
      }
      if (!state || !pending || pending.operationId !== input.operationId ||
        pending.controlGeneration !== input.controlGeneration ||
        pending.dispatchGeneration !== input.dispatchGeneration) {
        return {
          next: null,
          result: { status: "binding_conflict" as const },
        };
      }
      const next = structuredClone(current);
      const nextState = next.callLink!.translationControl!;
      if (input.succeeded) {
        nextState.uplinkPaused = pending.requestedPaused;
      } else if (pending.requestedPaused) {
        nextState.uplinkPaused = true;
      }
      delete nextState.pending;
      nextState.lastSettledOperationId = input.operationId;
      nextState.lastSettledControlGeneration = input.controlGeneration;
      nextState.lastSettledDispatchGeneration = input.dispatchGeneration;
      nextState.lastSettledRequestedPaused = pending.requestedPaused;
      nextState.lastSettledSucceeded = input.succeeded;
      nextState.updatedAt = (input.now ?? new Date()).toISOString();
      return {
        next,
        result: (saved: SessionRecord) => ({
          status: "updated" as const,
          state: saved.callLink!.translationControl!,
        }),
      };
    },
  );
}

export function prepareCallLinkUplinkResume(input: {
  sessionId: string;
  operationId: string;
  controlGeneration: number;
  dispatchGeneration: number;
  now?: Date;
}) {
  return mutate<SettleUplinkControlResult>(
    input.sessionId,
    "translation-uplink-resume-prepare",
    input,
    (current) => {
      const state = current.callLink?.translationControl;
      const pending = state?.pending;
      if (!state || !pending || pending.requestedPaused ||
        pending.operationId !== input.operationId ||
        pending.controlGeneration !== input.controlGeneration ||
        pending.dispatchGeneration !== input.dispatchGeneration) {
        return { next: null,
          result: { status: "binding_conflict" as const } };
      }
      if (pending.resumePreparedAt) {
        return { next: null,
          result: { status: "replayed" as const, state } };
      }
      const next = structuredClone(current);
      const preparedAt = (input.now ?? new Date()).toISOString();
      next.callLink!.translationControl!.pending!.resumePreparedAt =
        preparedAt;
      next.callLink!.translationControl!.updatedAt =
        preparedAt;
      return {
        next,
        result: (saved: SessionRecord) => ({
          status: "updated" as const,
          state: saved.callLink!.translationControl!,
        }),
      };
    },
  );
}

export async function findCallLinkTranslationState(sessionId: string) {
  return (await findSession(sessionId))?.callLink?.translationControl ?? null;
}

export function recordCallLinkDiagnosticMarker(input: {
  sessionId: string;
  marker: CallLinkDiagnosticMarker;
}) {
  return mutate<DiagnosticMarkerResult>(
    input.sessionId,
    "call-diagnostic-marker",
    input.marker,
    (current) => {
      if (!current.callLink) {
        return { next: null, result: { status: "not_found" as const } };
      }
      const markers = current.callLink.diagnosticMarkers ?? [];
      const existing = markers.find((item) => item.id === input.marker.id);
      if (existing) {
        return {
          next: null,
          result: existing.category === input.marker.category
            ? { status: "replayed" as const, marker: existing }
            : { status: "payload_conflict" as const, marker: existing },
        };
      }
      const next = structuredClone(current);
      next.callLink!.diagnosticMarkers = [
        ...(next.callLink!.diagnosticMarkers ?? []).slice(-31),
        input.marker,
      ];
      return {
        next,
        result: (saved: SessionRecord) => ({
          status: "recorded" as const,
          marker: saved.callLink!.diagnosticMarkers!.at(-1)!,
        }),
      };
    },
  );
}

function mutate<T>(
  sessionId: string,
  operation: string,
  payload: unknown,
  plan: (current: SessionRecord) => MutationPlan<T>,
) {
  return mutateSessionRecord(
    sessionId,
    operation,
    payload,
    plan,
    () => mutateLegacyCallLinkTranslationState(sessionId, plan),
  );
}

interface MutationPlan<T> {
  next: SessionRecord | null;
  result: T | ((saved: SessionRecord) => T);
}
