import type { WebSocket } from "ws";
import type { RealtimeEnv } from "../config/env.js";
import { verifyRealtimeToken } from "../auth/realtime-token-verifier.js";
import { extractRealtimeConnectionToken } from
  "../auth/realtime-connection-token.js";
import { buildError, serializeEvent } from "../protocol/outgoing-event-builder.js";
import type { ServerRealtimeEvent } from "@translation/contracts";
import {
  activeSessionCount,
  attachSession,
  getSession,
} from "../sessions/session-manager.js";
import type { IncomingMessage } from "node:http";

export function admitRealtimeConnection(
  ws: WebSocket,
  request: IncomingMessage,
  env: RealtimeEnv,
) {
  const token = extractRealtimeConnectionToken(
    request,
    env.allowQueryToken === true,
  );
  const claims = token ? verifyRealtimeToken(token, env.realtimeTokenSecret) : null;
  if (!claims) {
    sendRealtimeEvent(ws, buildError("invalid_token", "Invalid realtime token", {
      stage: "connection",
      retryable: false,
    }));
    ws.close();
    return null;
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

export function sendRealtimeEvent(ws: WebSocket, event: ServerRealtimeEvent) {
  if (ws.readyState === 1) ws.send(serializeEvent(event));
}
