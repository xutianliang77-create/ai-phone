import type {
  RealtimeSessionDiagnosticsDto,
  SessionReviewResponse,
  SessionSegmentDto,
} from "@translation/contracts";
import {
  transitionRealtimeSessionState,
  type PersistedRealtimeSessionState,
} from "@translation/contracts";
import { assertNewSessionPlacementAllowed } from
  "../../infrastructure/platform/platform-session-routing.js";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { CallLegRecord } from "../call-links/call-link-record.js";
import * as legacy from "./sessions.repository.js";
import type { SessionRecord } from "./session-record.js";
import {
  applySessionSegmentPatch,
  createSessionSegment,
  mergeSessionSegments,
  type SessionSegmentPatch,
} from "./session-segment-merge.js";
import {
  sessionMatchesQuery,
  sessionSpeakerSummary,
} from "./sessions-runtime-views.js";

export type { SessionRecord } from "./session-record.js";
export { SessionVersionConflictError } from "./sessions.repository.js";

export async function createSession(record: SessionRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.createSession(record);
  const routing = assertNewSessionPlacementAllowed();
  const requested: SessionRecord = {
    ...structuredClone(record),
    version: 1,
    lastActivityAt: record.lastActivityAt ?? record.createdAt,
    homeRegion: record.homeRegion ?? routing.homeRegion,
    homeCellId: record.homeCellId ?? routing.homeCellId,
    routingGeneration: record.routingGeneration ?? routing.routingGeneration,
  };
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: record.id },
    async (fence) => {
      const requestHash = repositoryRequestHash(requested);
      const result = await runtime.postgres.sessions.create({
        sessionId: record.id,
        record: requested,
        commandId: commandId(record.id, "create", 0, requestHash),
        commandType: "session.create",
        requestHash,
        fence,
      });
      return result.session;
    },
  );
}

export function findSession(sessionId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.sessions.find(sessionId)
    : Promise.resolve(legacy.findSession(sessionId));
}

export async function assertSessionVersion(
  sessionId: string,
  expectedVersion: number | undefined,
) {
  const session = await findSession(sessionId);
  if (!session || expectedVersion === undefined) return session;
  const currentVersion = session.version ?? 1;
  if (currentVersion !== expectedVersion) {
    throw new legacy.SessionVersionConflictError(
      sessionId,
      expectedVersion,
      currentVersion,
    );
  }
  return session;
}

export async function listSessions(userId: string, query?: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.listSessions(userId, query);
  const sessions = await runtime.postgres.sessions.list(userId, 500);
  const normalized = (query ?? "").trim().toLowerCase();
  return sessions.filter((session) => sessionMatchesQuery(session, normalized));
}

export async function deleteSession(sessionId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.deleteSession(sessionId);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      const current = await runtime.postgres.sessions.find(sessionId);
      if (!current) return false;
      const requestHash = repositoryRequestHash({ sessionId, version: current.version });
      const result = await runtime.postgres.sessions.delete({
        sessionId,
        commandId: commandId(sessionId, "delete", current.version ?? 1, requestHash),
        commandType: "session.delete",
        requestHash,
        fence,
      });
      return result.status === "deleted";
    },
  );
}

export function upsertCallLeg(sessionId: string, callLeg: CallLegRecord) {
  return mutateSession(sessionId, "call-leg-upsert", callLeg, (current) => {
    if (current.mode !== "call_link") return { next: null, result: null };
    const next = structuredClone(current);
    const callLegs = next.callLegs ?? [];
    const index = callLegs.findIndex((leg) => leg.id === callLeg.id);
    if (index >= 0) callLegs[index] = { ...callLegs[index], ...callLeg };
    else callLegs.push(callLeg);
    next.callLegs = callLegs;
    next.lastActivityAt = new Date().toISOString();
    return { next, result: (saved: SessionRecord) => saved };
  }, () => legacy.upsertCallLeg(sessionId, callLeg));
}

export function endCallLegs(sessionId: string, endedAt: string) {
  return mutateSession(sessionId, "call-legs-end", { endedAt }, (current) => {
    if (!current.callLegs?.some((leg) => leg.status !== "ended")) {
      return { next: null, result: current };
    }
    const next = structuredClone(current);
    next.callLegs = next.callLegs!.map((leg) => leg.status === "ended"
      ? leg : { ...leg, status: "ended", endedAt });
    return { next, result: (saved: SessionRecord) => saved };
  }, () => legacy.endCallLegs(sessionId, endedAt));
}

export function endSession(sessionId: string, now = new Date()) {
  return mutateSession(sessionId, "end", { endedAt: now.toISOString() }, (current) => {
    if (current.status === "ended") {
      return { next: null, result: { session: current, wasAlreadyEnded: true } };
    }
    const transition = transitionRealtimeSessionState(current.status, "ended");
    if (!transition.accepted) return { next: null, result: null };
    const next = structuredClone(current);
    next.status = "ended";
    next.endedAt = now.toISOString();
    next.lastActivityAt = next.endedAt;
    return {
      next,
      result: (saved: SessionRecord) => ({ session: saved, wasAlreadyEnded: false }),
    };
  }, () => legacy.endSession(sessionId, now));
}

export function transitionSessionState(
  sessionId: string,
  status: PersistedRealtimeSessionState,
) {
  return mutateSession(sessionId, "transition", { status }, (current) => {
    const transition = transitionRealtimeSessionState(current.status, status);
    if (!transition.accepted) return { next: null, result: { session: current, transition } };
    const next = structuredClone(current);
    if (transition.changed) next.status = status;
    next.lastActivityAt = new Date().toISOString();
    return {
      next,
      result: (saved: SessionRecord) => ({ session: saved, transition }),
    };
  }, () => legacy.transitionSessionState(sessionId, status));
}

export function saveSegments(sessionId: string, segments: SessionSegmentDto[]) {
  return updateSession(sessionId, "segments-save", segments, (next) => {
    next.segments = mergeSessionSegments(next.segments, segments);
    next.review = null;
    next.lastActivityAt = new Date().toISOString();
  }, () => legacy.saveSegments(sessionId, segments));
}

export function saveSessionReview(sessionId: string, review: SessionReviewResponse) {
  return updateSession(sessionId, "review-save", review, (next) => {
    next.review = review;
  }, () => legacy.saveSessionReview(sessionId, review));
}

export function updateSessionReviewActionItem(
  sessionId: string,
  actionIndex: number,
  completed: boolean,
) {
  return mutateSession(sessionId, "review-action", { actionIndex, completed }, (current) => {
    const actionItem = current.review?.actionItems?.[actionIndex];
    if (!actionItem) return { next: null, result: null };
    const next = structuredClone(current);
    const actionItems = next.review?.actionItems;
    if (!actionItems) return { next: null, result: null };
    actionItems[actionIndex] = { ...actionItem, completed };
    return { next, result: (saved: SessionRecord) => saved };
  }, () => legacy.updateSessionReviewActionItem(sessionId, actionIndex, completed));
}

export function saveSessionDiagnostics(
  sessionId: string,
  diagnostics: RealtimeSessionDiagnosticsDto,
) {
  return updateSession(sessionId, "diagnostics-save", diagnostics, (next) => {
    next.diagnostics = diagnostics;
  }, () => legacy.saveSessionDiagnostics(sessionId, diagnostics));
}

export async function listSessionSpeakers(sessionId: string) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.listSessionSpeakers(sessionId);
  const session = await runtime.postgres.sessions.find(sessionId);
  if (!session) return null;
  return sessionSpeakerSummary(session);
}

export function renameSessionSpeaker(
  sessionId: string,
  speakerId: string,
  displayName: string,
) {
  return mutateSession(sessionId, "speaker-rename", { speakerId, displayName }, (current) => {
    if (!current.segments.some((segment) => segment.speaker?.speakerId === speakerId)) {
      return { next: null, result: null };
    }
    const next = structuredClone(current);
    for (const segment of next.segments) {
      if (segment.speaker?.speakerId === speakerId) {
        segment.speaker = { ...segment.speaker, displayName };
      }
    }
    next.review = null;
    return { next, result: (saved: SessionRecord) => saved };
  }, () => legacy.renameSessionSpeaker(sessionId, speakerId, displayName));
}

export function upsertSegment(sessionId: string, patch: SessionSegmentPatch) {
  return updateSession(sessionId, "segment-upsert", patch, (next) => {
    const existing = next.segments.find((segment) => segment.id === patch.segmentId);
    if (existing) applySessionSegmentPatch(existing, patch);
    else next.segments.push(createSessionSegment(patch));
    next.review = null;
    next.lastActivityAt = new Date().toISOString();
  }, () => legacy.upsertSegment(sessionId, patch));
}

export function updateConsumedSeconds(sessionId: string, consumedSeconds: number) {
  return updateSession(sessionId, "usage-seconds", { consumedSeconds }, (next) => {
    next.consumedSeconds = consumedSeconds;
    next.lastActivityAt = new Date().toISOString();
  }, () => legacy.updateConsumedSeconds(sessionId, consumedSeconds));
}

export function markSessionFinalized(sessionId: string, idempotencyKey: string) {
  return updateSession(sessionId, "finalized", { idempotencyKey }, (next) => {
    next.finalizationIdempotencyKey = idempotencyKey;
    next.finalizedAt = new Date().toISOString();
    next.lastActivityAt = next.finalizedAt;
  }, () => legacy.markSessionFinalized(sessionId, idempotencyKey));
}

function updateSession(
  sessionId: string,
  operation: string,
  payload: unknown,
  update: (next: SessionRecord) => void,
  legacyOperation: () => SessionRecord | null,
) {
  return mutateSession(sessionId, operation, payload, (current) => {
    const next = structuredClone(current);
    update(next);
    return { next, result: (saved: SessionRecord) => saved };
  }, legacyOperation);
}

async function mutateSession<T>(
  sessionId: string,
  operation: string,
  payload: unknown,
  plan: (current: SessionRecord) => MutationPlan<T>,
  legacyOperation: () => T,
): Promise<T | null> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacyOperation();
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await runtime.postgres.sessions.find(sessionId);
        if (!current) return null;
        const mutation = plan(current);
        if (!mutation.next) return resolveResult(mutation.result, current);
        mutation.next.version = (current.version ?? 1) + 1;
        const requestHash = repositoryRequestHash({ operation, payload });
        const result = await runtime.postgres.sessions.update({
          sessionId,
          expectedVersion: current.version,
          mutate: () => mutation.next,
          commandId: commandId(sessionId, operation, current.version ?? 1, requestHash),
          commandType: `session.${operation}`.slice(0, 100),
          requestHash,
          fence,
        });
        if (result.status === "version_conflict") continue;
        if (result.status === "not_found") return null;
        return resolveResult(mutation.result, result.session);
      }
      const latest = await runtime.postgres.sessions.find(sessionId);
      throw new legacy.SessionVersionConflictError(
        sessionId,
        Number(latest?.version ?? 0) - 1,
        Number(latest?.version ?? 0),
      );
    },
  );
}

function resolveResult<T>(value: T | ((saved: SessionRecord) => T), saved: SessionRecord) {
  return typeof value === "function"
    ? (value as (session: SessionRecord) => T)(saved) : value;
}

function commandId(sessionId: string, operation: string, version: number, hash: string) {
  return repositoryCommandId({
    aggregateId: sessionId,
    operation,
    version,
    requestHash: hash,
  });
}

interface MutationPlan<T> {
  next: SessionRecord | null;
  result: T | ((saved: SessionRecord) => T);
}
