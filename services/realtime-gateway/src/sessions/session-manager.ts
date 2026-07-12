import {
  transitionRealtimeSessionState,
  type RealtimeTokenClaims,
} from "@translation/contracts";
import type { RealtimeSession } from "./realtime-session.js";

const sessions = new Map<string, RealtimeSession>();

export function createSession(claims: RealtimeTokenClaims): RealtimeSession {
  const now = Date.now();
  const session: RealtimeSession = {
    id: claims.sessionId,
    userId: claims.userId,
    claims,
    status: "active",
    startedAt: now,
    activeStartedAt: now,
    accumulatedActiveMs: 0,
    connectionGeneration: 1,
    billableSeconds: 0,
  };
  sessions.set(session.id, session);
  return session;
}

export function attachSession(claims: RealtimeTokenClaims) {
  const existing = getSession(claims.sessionId);
  if (!existing) {
    const session = createSession(claims);
    return { session, generation: session.connectionGeneration, resumed: false };
  }
  if (existing.userId !== claims.userId || existing.status !== "connecting") {
    return null;
  }
  existing.connectionGeneration += 1;
  return {
    session: existing,
    generation: existing.connectionGeneration,
    resumed: true,
  };
}

export function confirmSessionConnection(
  sessionId: string,
  generation: number,
) {
  const session = getSession(sessionId);
  if (!session || session.connectionGeneration !== generation) return false;
  if (session.status === "connecting") {
    const target = session.reconnectStatus ?? "active";
    const result = transitionStatus(sessionId, target);
    if (!result?.transition.accepted) return false;
  }
  session.reconnectStatus = undefined;
  session.disconnectDeadlineAt = undefined;
  return true;
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

export function transitionStatus(
  sessionId: string,
  status: RealtimeSession["status"],
  nowMs: () => number = Date.now,
) {
  const session = getSession(sessionId);
  if (!session) return null;
  const transition = transitionRealtimeSessionState(session.status, status);
  if (transition.changed) {
    const now = nowMs();
    if (session.status === "active" && session.activeStartedAt !== undefined) {
      session.accumulatedActiveMs += Math.max(0, now - session.activeStartedAt);
      session.activeStartedAt = undefined;
    }
    session.status = status;
    if (status === "active") session.activeStartedAt = now;
  }
  return { session, transition };
}

export function sessionBillableSeconds(
  session: RealtimeSession,
  nowMs: () => number = Date.now,
) {
  const currentActiveMs = session.status === "active" && session.activeStartedAt !== undefined
    ? Math.max(0, nowMs() - session.activeStartedAt)
    : 0;
  const activeSeconds = Math.ceil(
    (session.accumulatedActiveMs + currentActiveMs) / 1000,
  );
  return Math.max(session.billableSeconds, activeSeconds);
}

export function deleteSession(sessionId: string, expectedSession?: RealtimeSession) {
  const session = getSession(sessionId);
  if (!session || (expectedSession && session !== expectedSession)) return false;
  return sessions.delete(sessionId);
}
