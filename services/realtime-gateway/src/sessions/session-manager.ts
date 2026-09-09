import {
  transitionRealtimeSessionState,
  type RealtimeTokenClaims,
  type PublicAdmissionReceipt,
  publicRuntimeTokenBinding,
  matchesPublicAdmissionReceipt,
} from "@translation/contracts";
import {isDeepStrictEqual} from "node:util";
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

export function attachSession(claims: RealtimeTokenClaims,
    recovery?:{expectedGeneration:number;receipt:PublicAdmissionReceipt}) {
  const existing = getSession(claims.sessionId);
  if (!existing) {
    if(recovery)return null; // Recovery must never allocate a replacement session.
    const session = createSession(claims);
    return { session, generation: session.connectionGeneration, resumed: false };
  }
  if (existing.userId !== claims.userId || existing.status !== "connecting") {
    return null;
  }
  if(existing.claims.publicRuntime){
    const saved=existing.publicDisconnect;
    if(!recovery||!saved||!Number.isSafeInteger(existing.connectionGeneration+1)||existing.connectionGeneration<1||existing.connectionGeneration!==recovery.expectedGeneration||saved.generation!==recovery.expectedGeneration||
      !isDeepStrictEqual(existing.claims,claims)||!recoveryReceiptMatches(claims,recovery.receipt)||
      !isDeepStrictEqual(saved.receipt.recovery,recovery.receipt.recovery)||
      claims.expiresAt<=Math.floor(Date.now()/1000))return null;
    // Same-process compare-and-set, after a fresh API checkpoint comparison.
    // No ownership guarantee across Gateways and no audio/provider resumption.
    existing.reconnectStatus="paused";existing.publicDisconnect=undefined;
  }else if(recovery)return null;
  existing.connectionGeneration += 1;
  return {
    session: existing,
    generation: existing.connectionGeneration,
    resumed: true,
  };
}

function recoveryReceiptMatches(claims:RealtimeTokenClaims,receipt:PublicAdmissionReceipt){
  const binding=publicRuntimeTokenBinding(claims,claims.publicRuntime?.deploymentId??"");
  if(!binding||!receipt)return false;
  return matchesPublicAdmissionReceipt(receipt,{...binding,contractVersion:1,requestId:receipt.requestId,
    sessionId:claims.sessionId,ownerId:claims.userId,modelPolicyRevision:claims.processing!.modelPolicyRevision,
    grantRef:claims.processing!.publicGrantRef!,purpose:"recovery"});
}

/** Install only after the original pipeline drains and the trusted API confirms
 * disconnected. The existing session remains non-active; no timer/window reset. */
export function recordPublicDisconnectCheckpoint(sessionId:string,generation:number,receipt:PublicAdmissionReceipt){
  const session=getSession(sessionId);
  if(!session||session.connectionGeneration!==generation||!recoveryReceiptMatches(session.claims,receipt))return false;
  if(session.publicDisconnect)return session.status==="connecting"&&session.publicDisconnect.generation===generation&&
    isDeepStrictEqual(session.publicDisconnect.receipt.recovery,receipt.recovery);
  if(session.status!=="active"&&session.status!=="paused")return false;
  if(!transitionStatus(sessionId,"connecting")?.transition.accepted)return false;
  session.reconnectStatus="paused";
  session.disconnectDeadlineAt=Date.parse(receipt.recovery!.recoveryUntil);
  session.publicDisconnect={generation,receipt:structuredClone(receipt)};
  return true;
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
