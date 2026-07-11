import {
  transitionRealtimeSessionState,
  type RealtimeTokenClaims,
} from "@translation/contracts";
import type { RealtimeSession } from "./realtime-session.js";

const sessions = new Map<string, RealtimeSession>();

export function createSession(claims: RealtimeTokenClaims): RealtimeSession {
  const session: RealtimeSession = {
    id: claims.sessionId,
    userId: claims.userId,
    claims,
    status: "active",
    startedAt: Date.now(),
    billableSeconds: 0,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(sessionId: string) {
  return sessions.get(sessionId) ?? null;
}

export function transitionStatus(
  sessionId: string,
  status: RealtimeSession["status"],
) {
  const session = getSession(sessionId);
  if (!session) return null;
  const transition = transitionRealtimeSessionState(session.status, status);
  if (transition.changed) session.status = status;
  return { session, transition };
}

export function deleteSession(sessionId: string, expectedSession?: RealtimeSession) {
  const session = getSession(sessionId);
  if (!session || (expectedSession && session !== expectedSession)) return false;
  return sessions.delete(sessionId);
}
