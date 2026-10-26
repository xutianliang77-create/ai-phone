import {controlClock} from '../connection/control-budget.js';
import {
  transitionRealtimeSessionState,
  type RealtimeTokenClaims,
} from "@translation/contracts";
import type { RealtimeSession } from "./realtime-session.js";

const sessions = new Map<string, RealtimeSession>();
const closedSessions = new Map<string, { userId: string; expiresAt: number; billableSeconds: number; gatewayReceipt?: string }>();

export function createSession(claims: RealtimeTokenClaims): RealtimeSession {
  const now = Date.now();
  const formalRelease = process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL === "app_store" || (process.env.AUTH_PROVIDER === "apple" || process.env.V10_CONTROL_AUTHORITY === "cloudflare");
  const session: RealtimeSession = {
    id: claims.sessionId,
    userId: claims.userId,
    claims,
    status: formalRelease ? "connecting" : "active",
    startedAt: now,
    activeStartedAt: formalRelease ? undefined : now,
    ...(formalRelease ? { formalRelease: true } : {}),
    accumulatedActiveMs: 0,
    connectionGeneration: 1,
    billableSeconds: 0,
  };
  sessions.set(session.id, session);
  return session;
}

export function attachSession(claims: RealtimeTokenClaims) {
  for (const [id, closed] of closedSessions) if (closed.expiresAt <= Date.now()) closedSessions.delete(id);
  if (closedSessions.has(claims.sessionId)) return null;
  const existing = getSession(claims.sessionId);
  if (!existing) {
    if (closedSessions.size >= 10000) return null;
    const session = createSession(claims);
    return { session, generation: session.connectionGeneration, resumed: false };
  }
  if (existing.userId !== claims.userId || existing.status !== "connecting") {
    return null;
  }
  if (existing.formalRelease &&
      (existing.providerCloseConfirmed !== true || (existing.disconnectDeadlineAt ?? 0) <= Date.now())) return null;
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

export function activeSessionCount() {
  return sessions.size;
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
    const now = controlClock(session,nowMs());
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
  const measured=Math.max(session.billableSeconds, activeSeconds);
  return session.claims.control?Math.min(session.claims.maxDurationSeconds,measured):measured;
}

export function deleteSession(sessionId: string, expectedSession?: RealtimeSession) {
  const session = getSession(sessionId);
  if (!session || (expectedSession && session !== expectedSession)) return false;
  if (session.formalRelease) {
    if (session.providerCloseConfirmed !== true) return false;
    closedSessions.set(sessionId, { userId: session.userId, expiresAt: session.claims.expiresAt * 1000,
      billableSeconds: sessionBillableSeconds(session), gatewayReceipt: session.gatewayReceipt });
  }
  return sessions.delete(sessionId);
}

export function closedSessionReceipt(sessionId: string, userId: string) {
  const entry = closedSessions.get(sessionId);
  if (!entry || entry.userId !== userId || entry.expiresAt <= Date.now()) return null;
  return entry;
}

/** No provider was dispatched: detach an unproven socket without inventing a
 * stop receipt or releasing the control-plane reservation. */
export function detachUnadmittedControlSession(session:RealtimeSession,generation:number){
 if(session.claims.control&&session.status==='connecting'&&session.connectionGeneration===generation&&session.providerCloseConfirmed!==false){
  if(session.controlPreviousNonce){session.controlConnectionNonce=session.controlPreviousNonce;session.controlPreviousNonce=undefined;}
  if(!session.controlConnectionNonce)sessions.delete(session.id);
 }
}
