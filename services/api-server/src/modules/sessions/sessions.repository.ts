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
import {
  applySessionSegmentPatch,
  createSessionSegment,
  mergeSessionSegments,
  type SessionSegmentPatch,
} from "./session-segment-merge.js";

export type { SessionRecord } from "./session-record.js";

export function createSession(record: SessionRecord) {
  const store = getStoreSnapshot();
  record.lastActivityAt ??= record.createdAt;
  store.sessions = [
    ...store.sessions.filter((session) => session.id !== record.id),
    record,
  ];
  persistStoreSnapshot();
  return record;
}

export function findSession(sessionId: string) {
  return getStoreSnapshot().sessions.find((session) => session.id === sessionId) ?? null;
}

export function endSession(sessionId: string) {
  const session = findSession(sessionId);
  if (!session) return null;
  const wasAlreadyEnded = session.status === "ended";
  if (wasAlreadyEnded) return { session, wasAlreadyEnded };
  const transition = transitionRealtimeSessionState(session.status, "ended");
  if (!transition.accepted) return null;
  session.status = "ended";
  session.endedAt = new Date().toISOString();
  session.lastActivityAt = session.endedAt;
  persistStoreSnapshot();
  return { session, wasAlreadyEnded };
}

export function transitionSessionState(
  sessionId: string,
  status: PersistedRealtimeSessionState,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  const transition = transitionRealtimeSessionState(session.status, status);
  if (transition.changed) {
    session.status = status;
    session.lastActivityAt = new Date().toISOString();
    persistStoreSnapshot();
  }
  return { session, transition };
}

export function listSessions(userId: string, query?: string) {
  const normalizedQuery = (query ?? "").trim().toLowerCase();
  return getStoreSnapshot().sessions
    .filter((session) => session.userId === userId)
    .filter((session) => matchesQuery(session, normalizedQuery))
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
  persistStoreSnapshot();
  return session;
}

export function saveSessionReview(
  sessionId: string,
  review: SessionReviewResponse,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.review = review;
  persistStoreSnapshot();
  return session;
}

export function saveSessionDiagnostics(
  sessionId: string,
  diagnostics: RealtimeSessionDiagnosticsDto,
) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.diagnostics = diagnostics;
  persistStoreSnapshot();
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
  persistStoreSnapshot();
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
  session.review = null;
  session.lastActivityAt = new Date().toISOString();
  persistStoreSnapshot();
  return session;
}

export function updateConsumedSeconds(sessionId: string, consumedSeconds: number) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.consumedSeconds = consumedSeconds;
  session.lastActivityAt = new Date().toISOString();
  persistStoreSnapshot();
  return session;
}

function matchesQuery(session: SessionRecord, query: string) {
  if (!query) return true;
  return [
    session.id,
    session.mode,
    session.status,
    session.createdAt,
    session.endedAt ?? "",
    ...session.segments.flatMap((segment) => [
      segment.sourceText,
      segment.rawText ?? "",
      segment.optimizedText ?? "",
      segment.translatedText,
    ]),
  ].some((value) => value.toLowerCase().includes(query));
}
