import type {
  LanguageCode,
  SessionSegmentProviderUsageDto,
  SessionReviewResponse,
  SessionSegmentDto,
  SessionSegmentStage,
  SessionSegmentRefinementDto,
  SegmentTimingDto,
  SpeakerAttributionDto,
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

export type { SessionRecord } from "./session-record.js";

export function createSession(record: SessionRecord) {
  const store = getStoreSnapshot();
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
  session.segments = mergeSegments(session.segments, segments);
  session.review = null;
  persistStoreSnapshot();
  return session;
}

function mergeSegments(
  existingSegments: SessionSegmentDto[],
  incomingSegments: SessionSegmentDto[],
) {
  const merged = [...existingSegments];
  const indexById = new Map(merged.map((segment, index) => [segment.id, index]));
  for (const incoming of incomingSegments) {
    const index = indexById.get(incoming.id);
    if (index === undefined) {
      indexById.set(incoming.id, merged.length);
      merged.push(incoming);
      continue;
    }
    merged[index] = mergeSegment(merged[index], incoming);
  }
  return merged;
}

function mergeSegment(
  existing: SessionSegmentDto,
  incoming: SessionSegmentDto,
): SessionSegmentDto {
  return {
    ...incoming,
    ...existing,
    sourceText: preferText(existing.sourceText, incoming.sourceText) ?? "",
    rawText: preferText(existing.rawText, incoming.rawText),
    optimizedText: preferText(existing.optimizedText, incoming.optimizedText),
    translatedText: preferText(existing.translatedText, incoming.translatedText) ?? "",
    sourceLanguage: existing.sourceLanguage ?? incoming.sourceLanguage,
    targetLanguage: existing.targetLanguage ?? incoming.targetLanguage,
    confidence: existing.confidence ?? incoming.confidence,
    stage: existing.stage ?? incoming.stage,
    provider: existing.provider ?? incoming.provider,
    model: existing.model ?? incoming.model,
    latencyMs: existing.latencyMs ?? incoming.latencyMs,
    providerUsage: existing.providerUsage ?? incoming.providerUsage,
    refinement: existing.refinement ?? incoming.refinement,
    speaker: existing.speaker ?? incoming.speaker,
    timing: existing.timing ?? incoming.timing,
  };
}

function preferText(left: string | undefined, right: string | undefined) {
  return left && left.trim().length > 0 ? left : right;
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
  patch: {
    segmentId: string;
    sourceText?: string;
    rawText?: string;
    optimizedText?: string;
    translatedText?: string;
    sourceLanguage?: LanguageCode;
    targetLanguage?: LanguageCode;
    confidence?: number;
    stage?: SessionSegmentStage;
    provider?: string;
    model?: string;
    latencyMs?: number;
    providerUsage?: SessionSegmentProviderUsageDto;
    refinement?: SessionSegmentRefinementDto;
    speaker?: SpeakerAttributionDto;
    timing?: SegmentTimingDto;
  },
) {
  const session = findSession(sessionId);
  if (!session) return null;
  const existing = session.segments.find((segment) => segment.id === patch.segmentId);
  if (existing) {
    if (typeof patch.sourceText === "string") existing.sourceText = patch.sourceText;
    if (typeof patch.rawText === "string") existing.rawText = patch.rawText;
    if (typeof patch.optimizedText === "string") {
      existing.optimizedText = patch.optimizedText;
    }
    if (typeof patch.translatedText === "string") {
      existing.translatedText = patch.translatedText;
    }
    applySegmentDiagnostics(existing, patch);
  } else {
    session.segments.push({
      id: patch.segmentId,
      sourceText: patch.sourceText ?? patch.optimizedText ?? patch.rawText ?? "",
      ...(patch.rawText ? { rawText: patch.rawText } : {}),
      ...(patch.optimizedText ? { optimizedText: patch.optimizedText } : {}),
      translatedText: patch.translatedText ?? "",
      ...buildSegmentDiagnostics(patch),
    });
  }
  session.review = null;
  persistStoreSnapshot();
  return session;
}

function applySegmentDiagnostics(
  segment: SessionSegmentDto,
  patch: {
    sourceLanguage?: LanguageCode;
    targetLanguage?: LanguageCode;
    confidence?: number;
    stage?: SessionSegmentStage;
    provider?: string;
    model?: string;
    latencyMs?: number;
    providerUsage?: SessionSegmentProviderUsageDto;
    refinement?: SessionSegmentRefinementDto;
    speaker?: SpeakerAttributionDto;
    timing?: SegmentTimingDto;
  },
) {
  const diagnostics = buildSegmentDiagnostics(patch);
  if (diagnostics.sourceLanguage) segment.sourceLanguage = diagnostics.sourceLanguage;
  if (diagnostics.targetLanguage) segment.targetLanguage = diagnostics.targetLanguage;
  if (typeof diagnostics.confidence === "number") {
    segment.confidence = diagnostics.confidence;
  }
  if (diagnostics.stage) segment.stage = diagnostics.stage;
  if (diagnostics.provider) segment.provider = diagnostics.provider;
  if (diagnostics.model) segment.model = diagnostics.model;
  if (typeof diagnostics.latencyMs === "number") {
    segment.latencyMs = diagnostics.latencyMs;
  }
  if (diagnostics.providerUsage) segment.providerUsage = diagnostics.providerUsage;
  if (diagnostics.refinement) segment.refinement = diagnostics.refinement;
  if (diagnostics.speaker) segment.speaker = diagnostics.speaker;
  if (diagnostics.timing) segment.timing = diagnostics.timing;
}

function buildSegmentDiagnostics(patch: {
  sourceLanguage?: LanguageCode;
  targetLanguage?: LanguageCode;
  confidence?: number;
  stage?: SessionSegmentStage;
  provider?: string;
  model?: string;
  latencyMs?: number;
  providerUsage?: SessionSegmentProviderUsageDto;
  refinement?: SessionSegmentRefinementDto;
  speaker?: SpeakerAttributionDto;
  timing?: SegmentTimingDto;
}) {
  return {
    ...(patch.sourceLanguage ? { sourceLanguage: patch.sourceLanguage } : {}),
    ...(patch.targetLanguage ? { targetLanguage: patch.targetLanguage } : {}),
    ...(typeof patch.confidence === "number" ? { confidence: patch.confidence } : {}),
    ...(patch.stage ? { stage: patch.stage } : {}),
    ...(patch.provider ?? patch.providerUsage?.provider
      ? { provider: patch.provider ?? patch.providerUsage?.provider }
      : {}),
    ...(patch.model ?? patch.providerUsage?.model
      ? { model: patch.model ?? patch.providerUsage?.model }
      : {}),
    ...(typeof (patch.latencyMs ?? patch.providerUsage?.latencyMs) === "number"
      ? { latencyMs: patch.latencyMs ?? patch.providerUsage?.latencyMs }
      : {}),
    ...(patch.providerUsage ? { providerUsage: patch.providerUsage } : {}),
    ...(patch.refinement ? { refinement: patch.refinement } : {}),
    ...(patch.speaker ? { speaker: patch.speaker } : {}),
    ...(patch.timing ? { timing: patch.timing } : {}),
  };
}

export function updateConsumedSeconds(sessionId: string, consumedSeconds: number) {
  const session = findSession(sessionId);
  if (!session) return null;
  session.consumedSeconds = consumedSeconds;
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
