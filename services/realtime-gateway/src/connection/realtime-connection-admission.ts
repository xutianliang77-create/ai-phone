import {selfHostedAdmission,selfHostedOwnerAllowed} from "@translation/platform-security";
import type { WebSocket } from "ws";
import type { RealtimeEnv } from "../config/env.js";
import { verifyRealtimeToken } from "../auth/realtime-token-verifier.js";
import { extractRealtimeConnectionToken } from
  "../auth/realtime-connection-token.js";
import { buildError, serializeEvent } from "../protocol/outgoing-event-builder.js";
import type { RealtimeTokenClaims, ServerRealtimeEvent } from "@translation/contracts";
import {
  activeSessionCount,
  attachSession,
  getSession,
  sessionBillableSeconds,
  closedSessionReceipt,
} from "../sessions/session-manager.js";
import type { IncomingMessage } from "node:http";

export function admitRealtimeConnection(
  ws: WebSocket,
  request: IncomingMessage,
  env: RealtimeEnv,
) {
  if(!selfHostedAdmission().open){
    sendRealtimeEvent(ws,buildError('provider_unavailable','Service admission is closed',{stage:'connection',retryable:true}));ws.close();return null;
  }
  if ((process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL === "app_store" || (process.env.AUTH_PROVIDER === "apple" || process.env.V10_CONTROL_AUTHORITY === "cloudflare")) &&
      (env.sessionEventSink !== "api" || env.realtimeTokenSecret.length < 32 || /dev-secret|replace-with|changeme/i.test(env.realtimeTokenSecret))) {
    sendRealtimeEvent(ws, buildError("provider_unavailable", "Gateway signing configuration is unavailable", { stage: "connection", retryable: true }));
    ws.close(); return null;
  }
  const token = extractRealtimeConnectionToken(
    request,
    env.allowQueryToken === true,
  );
  const claims = token ? verifyRealtimeToken(
    token, env.realtimeTokenSecret, canResumeExpiredToken,
  ) : null;
  if (!claims || (process.env.V10_CONTROL_AUTHORITY==='cloudflare'&&!claims.control) || !selfHostedOwnerAllowed(claims.userId)) {
    sendRealtimeEvent(ws, buildError("invalid_token", "Invalid realtime token", {
      stage: "connection",
      retryable: false,
    }));
    ws.close();
    return null;
  }
  const closed = closedSessionReceipt(claims.sessionId, claims.userId);
  if (closed) {
    sendRealtimeEvent(ws, { type: "session.ended", sessionId: claims.sessionId,
      billableSeconds: closed.billableSeconds, ...(closed.gatewayReceipt ? { gatewayReceipt: closed.gatewayReceipt } : {}) });
    ws.close(); return null;
  }

  if (!getSession(claims.sessionId) && activeSessionCount() >= env.maxSessions) {
    sendRealtimeEvent(ws, buildError("provider_unavailable", "Realtime session capacity reached", {
      sessionId: claims.sessionId,
      stage: "session",
      retryable: true,
    }));
    ws.close(1013, "session_capacity_reached");
    return null;
  }

  const attachment = attachSession(claims);
  if (attachment) return attachment;
  sendRealtimeEvent(ws, buildError("bad_event", "Realtime session cannot be resumed", {
    sessionId: claims.sessionId,
    stage: "session",
    retryable: false,
  }));
  ws.close();
  return null;
}

function canResumeExpiredToken(claims: RealtimeTokenClaims) {
  const session = getSession(claims.sessionId);
  return session?.status === "connecting" &&
    session.userId === claims.userId &&
    session.claims.issuedAt === claims.issuedAt &&
    session.claims.expiresAt === claims.expiresAt &&
    (session.disconnectDeadlineAt ?? 0) > Date.now() &&
    sessionBillableSeconds(session) < session.claims.maxDurationSeconds;
}

export function sendRealtimeEvent(ws: WebSocket, event: ServerRealtimeEvent) {
  if (ws.readyState === 1) ws.send(serializeEvent(event));
}
