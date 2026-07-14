import type {
  CallPlaybackDto,
  CallPlaybackInterruptReason,
  CallPlaybackStatus,
  CallRoomDataEvent,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";

const activeStatuses = new Set<CallPlaybackStatus>([
  "queued",
  "streaming",
  "interrupting",
]);

export class CallPlaybackConflictError extends Error {
  constructor(readonly playbackId: string, message: string) {
    super(message);
    this.name = "CallPlaybackConflictError";
  }
}

export function applyCallPlaybackEvent(
  sessionId: string,
  event: CallRoomDataEvent,
) {
  const status = eventStatus(event.type);
  if (!status) return null;
  const identity = playbackIdentity(event);
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId);
  if (!session || session.mode !== "call_link") return null;
  const playbacks = session.playbacks ?? [];
  const existing = playbacks.find((item) => item.id === identity.playbackId);
  const timestamp = new Date(event.timestampMs).toISOString();

  if (!existing) {
    if (status !== "queued") {
      throw conflict(identity.playbackId, "Playback must be queued before it starts");
    }
    assertGenerationAvailable(playbacks, identity.targetLegId, identity.generation);
    assertNoActivePlayback(playbacks, identity.targetLegId);
    const created: CallPlaybackDto = {
      id: identity.playbackId,
      segmentId: event.segmentId,
      sourceLegId: identity.sourceLegId,
      targetLegId: identity.targetLegId,
      generation: identity.generation,
      status: "queued",
      provider: event.provider,
      model: event.model,
      audioDurationMs: event.audioDurationMs,
      queuedAt: timestamp,
    };
    session.playbacks = [...playbacks, created];
    persistSessionMutation(session);
    return created;
  }

  assertPlaybackBinding(existing, event, identity);
  if (existing.status === status) return existing;
  assertTransition(existing, status);
  existing.status = status;
  if (status === "streaming") existing.startedAt = timestamp;
  if (isTerminal(status)) {
    existing.endedAt = timestamp;
    existing.interruptReason = interruptReason(event, status);
  }
  persistSessionMutation(session);
  return existing;
}

export function applyCallBargeInEvent(
  sessionId: string,
  event: CallRoomDataEvent,
) {
  if (event.type !== "barge_in.detected" && event.type !== "barge_in.confirmed") {
    return null;
  }
  const identity = playbackIdentity(event);
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId);
  const playback = session?.playbacks?.find((item) =>
    item.id === identity.playbackId
  );
  if (!session || !playback) return null;
  assertPlaybackBinding(playback, event, identity);
  const timestamp = new Date(event.timestampMs).toISOString();
  playback.bargeIn = {
    ...playback.bargeIn,
    ...(event.type === "barge_in.detected" ? { detectedAt: timestamp } : {}),
    ...(event.type === "barge_in.confirmed" ? { confirmedAt: timestamp } : {}),
    ...(event.stopLatencyMs === undefined
      ? {}
      : { stopLatencyMs: event.stopLatencyMs }),
    ...(event.speechDurationMs === undefined
      ? {}
      : { speechDurationMs: event.speechDurationMs }),
    ...(event.vadProvider ? { vadProvider: event.vadProvider } : {}),
    ...(event.vadProbability === undefined
      ? {}
      : { vadProbability: event.vadProbability }),
    ...(event.preRollMs === undefined ? {} : { preRollMs: event.preRollMs }),
  };
  persistSessionMutation(session);
  return playback;
}

export function interruptActiveCallPlaybacks(
  sessionId: string,
  reason: CallPlaybackInterruptReason,
  endedAt: string,
) {
  const session = getStoreSnapshot().sessions.find((item) => item.id === sessionId);
  if (!session?.playbacks?.length) return session ?? null;
  let changed = false;
  for (const playback of session.playbacks) {
    if (!activeStatuses.has(playback.status)) continue;
    playback.status = "interrupted";
    playback.interruptReason = reason;
    playback.endedAt = endedAt;
    changed = true;
  }
  if (changed) persistSessionMutation(session);
  return session;
}

function playbackIdentity(event: CallRoomDataEvent) {
  if (
    !event.playbackId ||
    !event.sourceLegId ||
    !event.targetLegId ||
    !Number.isInteger(event.generation) ||
    (event.generation ?? 0) < 1
  ) {
    throw conflict(event.playbackId ?? "unknown", "Playback identity is incomplete");
  }
  return {
    playbackId: event.playbackId,
    sourceLegId: event.sourceLegId,
    targetLegId: event.targetLegId,
    generation: event.generation as number,
  };
}

function assertGenerationAvailable(
  playbacks: CallPlaybackDto[],
  targetLegId: string,
  generation: number,
) {
  if (playbacks.some((item) =>
    item.targetLegId === targetLegId && item.generation >= generation
  )) {
    throw conflict("new", "Playback generation must increase per target leg");
  }
}

function assertNoActivePlayback(playbacks: CallPlaybackDto[], targetLegId: string) {
  if (playbacks.some((item) =>
    item.targetLegId === targetLegId && activeStatuses.has(item.status)
  )) {
    throw conflict("new", "Target leg already has an active playback");
  }
}

function assertPlaybackBinding(
  existing: CallPlaybackDto,
  event: CallRoomDataEvent,
  identity: ReturnType<typeof playbackIdentity>,
) {
  if (
    existing.segmentId !== event.segmentId ||
    existing.sourceLegId !== identity.sourceLegId ||
    existing.targetLegId !== identity.targetLegId ||
    existing.generation !== identity.generation
  ) {
    throw conflict(existing.id, "Playback event binding changed");
  }
}

function assertTransition(existing: CallPlaybackDto, next: CallPlaybackStatus) {
  const allowed = existing.status === "queued"
    ? new Set<CallPlaybackStatus>(["streaming", "interrupted", "failed"])
    : existing.status === "streaming"
    ? new Set<CallPlaybackStatus>(["interrupted", "completed", "failed"])
    : existing.status === "interrupting"
    ? new Set<CallPlaybackStatus>(["interrupted", "failed"])
    : new Set<CallPlaybackStatus>();
  if (!allowed.has(next)) {
    throw conflict(existing.id, `Playback cannot move from ${existing.status} to ${next}`);
  }
}

function eventStatus(type: CallRoomDataEvent["type"]): CallPlaybackStatus | null {
  if (type === "playback.queued") return "queued";
  if (type === "playback.started") return "streaming";
  if (type === "playback.interrupted") return "interrupted";
  if (type === "playback.ended") return "completed";
  if (type === "playback.failed") return "failed";
  return null;
}

function interruptReason(
  event: CallRoomDataEvent,
  status: CallPlaybackStatus,
): CallPlaybackInterruptReason | undefined {
  if (status === "failed") return "failure";
  if (status !== "interrupted") return undefined;
  const reason = event.playbackReason;
  return reason === "barge_in" ||
      reason === "session_end" ||
      reason === "superseded" ||
      reason === "failure" ||
      reason === "recovery"
    ? reason
    : "failure";
}

function isTerminal(status: CallPlaybackStatus) {
  return status === "interrupted" || status === "completed" || status === "failed";
}

function persistSessionMutation(session: { version?: number; lastActivityAt?: string }) {
  session.version = (session.version ?? 0) + 1;
  session.lastActivityAt = new Date().toISOString();
  persistStoreSnapshot();
}

function conflict(playbackId: string, message: string) {
  return new CallPlaybackConflictError(playbackId, message);
}
