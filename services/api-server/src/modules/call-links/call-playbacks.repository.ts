import type {
  CallPlaybackInterruptReason,
  CallRoomDataEvent,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import {
  applyCallBargeInState,
  applyCallPlaybackState,
  interruptCallPlaybackState,
} from "./call-playback-state.js";

export { CallPlaybackConflictError } from "./call-playback-state.js";

export function applyCallPlaybackEvent(
  sessionId: string,
  event: CallRoomDataEvent,
) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId) ?? null;
  const mutation = applyCallPlaybackState(session, event);
  if (mutation.changed && session) persistSessionMutation(session);
  return mutation.result;
}

export function applyCallBargeInEvent(
  sessionId: string,
  event: CallRoomDataEvent,
) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId) ?? null;
  const mutation = applyCallBargeInState(session, event);
  if (mutation.changed && session) persistSessionMutation(session);
  return mutation.result;
}

export function interruptActiveCallPlaybacks(
  sessionId: string,
  reason: CallPlaybackInterruptReason,
  endedAt: string,
) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId) ?? null;
  const mutation = interruptCallPlaybackState(session, reason, endedAt);
  if (mutation.changed && session) persistSessionMutation(session);
  return mutation.result;
}

function persistSessionMutation(
  session: { version?: number; lastActivityAt?: string },
) {
  session.version = (session.version ?? 0) + 1;
  session.lastActivityAt = new Date().toISOString();
  persistStoreSnapshot();
}
