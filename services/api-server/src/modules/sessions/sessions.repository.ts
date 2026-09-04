import type {
  SessionReviewResponse,
  SessionSegmentDto,
  SpeakerAttributionDto,
  RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";
import {
  transitionRealtimeSessionState,
  type PersistedRealtimeSessionState,
} from "@translation/contracts";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type { SessionRecord } from "./session-record.js";
import type { CallLegRecord } from "../call-links/call-link-record.js";
import {
  applySessionSegmentPatch,
  createSessionSegment,
  mergeSessionSegments,
  type SessionSegmentPatch,
} from "./session-segment-merge.js";
import { orderSessionSegmentsChronologically } from
  "./session-segment-order.js";
import { assertNewSessionPlacementAllowed } from "../../infrastructure/platform/platform-session-routing.js";
import { sessionMatchesQuery } from "./sessions-runtime-views.js";

export type { SessionRecord } from "./session-record.js";

export class SessionVersionConflictError extends Error {
  constructor(
    readonly sessionId: string,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super(
      `Session ${sessionId} version ${currentVersion} does not match ${expectedVersion}`,
    );
    this.name = "SessionVersionConflictError";
  }
}

export function createSession(record: SessionRecord) {
  const store = getStoreSnapshot();
  const routing = assertNewSessionPlacementAllowed();
  record.version ??= 1;
  record.lastActivityAt ??= record.createdAt;
  record.homeRegion ??= routing.homeRegion;
  record.homeCellId ??= routing.homeCellId;
  record.routingGeneration ??= routing.routingGeneration;
  store.sessions = [
    ...store.sessions.filter((session) => session.id !== record.id),
    record,
  ];
  persistStoreSnapshot();
  return record;
}

export function upsertCallLeg(sessionId: string, callLeg: CallLegRecord) {
  const session = findSession(sessionId);
  if (!session || session.mode !== "call_link") return null;
  const callLegs = session.callLegs ?? [];
  const position = callLegs.findIndex((leg) => leg.id === callLeg.id);
  if (position >= 0) {
    callLegs[position] = { ...callLegs[position], ...callLeg };
  } else {
    callLegs.push(callLeg);
  }
  session.callLegs = callLegs;
  session.lastActivityAt = new Date().toISOString();
  persistSessionMutation(session);
  return session;
}

export function endCallLegs(sessionId: string, endedAt: string) {
  const session = findSession(sessionId);
  if (!session || !session.callLegs?.length) return session;
  let changed = false;
  session.callLegs = session.callLegs.map((leg) => {
    if (leg.status === "ended") return leg;
    changed = true;
    return { ...leg, status: "ended", endedAt };
  });
  if (changed) persistSessionMutation(session);
  return session;
}

export function findSession(sessionId: string) {
  return getStoreSnapshot().sessions.find((session) => session.id === sessionId) ?? null;
}

export function assertSessionVersion(
  sessionId: string,
  expectedVersion: number | undefined,
) {
  const session = findSession(sessionId);
  if (!session || expectedVersion === undefined) return session;
  const currentVersion = session.version ?? 1;
  if (currentVersion !== expectedVersion) {
    throw new SessionVersionConflictError(
      sessionId,
      expectedVersion,
      currentVersion,
    );
  }
  return session;
}

export function endSession(sessionId: string, now = new Date()) {
  const session = findSession(sessionId);
  if (!session) return null;
  const wasAlreadyEnded = session.status === "ended";
  if (wasAlreadyEnded) return { session, wasAlreadyEnded };
  const transition = transitionRealtimeSessionState(session.status, "ended");
  if (!transition.accepted) return null;
  session.status = "ended";
  session.endedAt = now.toISOString();
  session.lastActivityAt = session.endedAt;
  persistSessionMutation(session);
  return { session, wasAlreadyEnded };
}

export function transitionSessionState(
  sessionId: string,
  status: PersistedRealtimeSessionState,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  const transition = transitionRealtimeSessionState(session.status, status);
  if (transition.changed) session.status = status;
  if (transition.accepted) {
    session.lastActivityAt = new Date().toISOString();
    persistSessionMutation(session);
  }
  return { session, transition };
}

export function listSessions(userId: string, query?: string) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return getStoreSnapshot().sessions
    .filter((session) => session.userId === userId)
    .filter((session) => sessionMatchesQuery(session, normalizedQuery))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function deleteSession(sessionId: string) {
  const store = getStoreSnapshot();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((session) => session.id !== sessionId);
  if (store.sessions.length === before) return false;
  persistStoreSnapshot();
  return true;
}

export function saveSegments(sessionId: string, segments: SessionSegmentDto[]) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.segments = mergeSessionSegments(session.segments, segments);
  session.review = null;
  session.lastActivityAt = new Date().toISOString();
  persistSessionMutation(session);
  return session;
}

export function saveSessionReview(
  sessionId: string,
  review: SessionReviewResponse,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.review = review;
  persistSessionMutation(session);
  return session;
}

export function updateSessionReviewActionItem(
  sessionId: string,
  actionIndex: number,
  completed: boolean,
) {
  const session = findSession(sessionId);
  const actionItems = session?.review?.actionItems;
  if (!session || !actionItems?.[actionIndex]) return null;
  actionItems[actionIndex] = {
    ...actionItems[actionIndex],
    completed,
  };
  persistSessionMutation(session);
  return session;
}

export function saveSessionDiagnostics(
  sessionId: string,
  diagnostics: RealtimeSessionDiagnosticsDto,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.diagnostics = diagnostics;
  persistSessionMutation(session);
  return session;
}

export function listSessionSpeakers(sessionId: string) {
  const session = findSession(sessionId);
  if (!session) return null;
  const speakers = new Map<string, {
    speaker: SpeakerAttributionDto;
    segmentCount: number;
    totalDurationMs: number;
  }>();
  for (const segment of session.segments) {
    if (!segment.speaker) continue;
    const current = speakers.get(segment.speaker.speakerId) ?? {
      speaker: segment.speaker,
      segmentCount: 0,
      totalDurationMs: 0,
    };
    current.segmentCount += 1;
    current.totalDurationMs += segment.timing
      ? Math.max(0, segment.timing.endMs - segment.timing.startMs)
      : 0;
    if (segment.speaker.displayName) current.speaker = segment.speaker;
    speakers.set(segment.speaker.speakerId, current);
  }
  return [...speakers.values()];
}

export function renameSessionSpeaker(
  sessionId: string,
  speakerId: string,
  displayName: string,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  let changed = false;
  for (const segment of session.segments) {
    if (segment.speaker?.speakerId !== speakerId) continue;
    segment.speaker = { ...segment.speaker, displayName };
    changed = true;
  }
  if (!changed) return null;
  session.review = null;
  persistSessionMutation(session);
  return session;
}

export function upsertSegment(
  sessionId: string,
  patch: SessionSegmentPatch,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  const existing = session.segments.find((segment) => segment.id === patch.segmentId);
  if (existing) {
    applySessionSegmentPatch(existing, patch);
  } else {
    session.segments.push(createSessionSegment(patch));
  }
  session.segments = orderSessionSegmentsChronologically(session.segments);
  session.review = null;
  session.lastActivityAt = new Date().toISOString();
  persistSessionMutation(session);
  return session;
}

export function updateConsumedSeconds(sessionId: string, consumedSeconds: number) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.consumedSeconds = consumedSeconds;
  session.lastActivityAt = new Date().toISOString();
  persistSessionMutation(session);
  return session;
}

export function markSessionFinalized(
  sessionId: string,
  idempotencyKey: string,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.finalizationIdempotencyKey = idempotencyKey;
  session.finalizedAt = new Date().toISOString();
  session.lastActivityAt = session.finalizedAt;
  persistSessionMutation(session);
  return session;
}

function persistSessionMutation(session: SessionRecord) {
  session.version = (session.version ?? 0) + 1;
  persistStoreSnapshot();
}
