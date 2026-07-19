import type {
  CallPlaybackInterruptReason,
  CallRoomDataEvent,
} from "@translation/contracts";
import { mutateSessionRecord } from
  "../sessions/sessions-runtime.repository.js";
import {
  applyCallBargeInState,
  applyCallPlaybackState,
  interruptCallPlaybackState,
} from "./call-playback-state.js";
import * as legacy from "./call-playbacks.repository.js";

export { CallPlaybackConflictError } from "./call-playback-state.js";

export function applyCallPlaybackEvent(
  sessionId: string,
  event: CallRoomDataEvent,
) {
  return mutateSessionRecord(
    sessionId,
    "playback-event",
    event,
    (current) => {
      const next = structuredClone(current);
      const mutation = applyCallPlaybackState(next, event);
      if (!mutation.changed) return { next: null, result: mutation.result };
      next.lastActivityAt = new Date().toISOString();
      return {
        next,
        result: (saved: typeof next) => saved.playbacks?.find(
          (playback) => playback.id === mutation.result?.id,
        ) ?? null,
      };
    },
    () => legacy.applyCallPlaybackEvent(sessionId, event),
  );
}

export function applyCallBargeInEvent(
  sessionId: string,
  event: CallRoomDataEvent,
) {
  return mutateSessionRecord(
    sessionId,
    "barge-in-event",
    event,
    (current) => {
      const next = structuredClone(current);
      const mutation = applyCallBargeInState(next, event);
      if (!mutation.changed) return { next: null, result: mutation.result };
      next.lastActivityAt = new Date().toISOString();
      return {
        next,
        result: (saved: typeof next) => saved.playbacks?.find(
          (playback) => playback.id === mutation.result?.id,
        ) ?? null,
      };
    },
    () => legacy.applyCallBargeInEvent(sessionId, event),
  );
}

export function interruptActiveCallPlaybacks(
  sessionId: string,
  reason: CallPlaybackInterruptReason,
  endedAt: string,
) {
  return mutateSessionRecord(
    sessionId,
    "playback-interrupt",
    { reason, endedAt },
    (current) => {
      const next = structuredClone(current);
      const mutation = interruptCallPlaybackState(next, reason, endedAt);
      return mutation.changed
        ? { next, result: (saved: typeof next) => saved }
        : { next: null, result: current };
    },
    () => legacy.interruptActiveCallPlaybacks(sessionId, reason, endedAt),
  );
}
