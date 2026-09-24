import type { ServerRealtimeEvent, SessionEndReason } from "@translation/contracts";
import type { WebSocket } from "ws";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import type { UsageBalanceClient } from "../usage/usage-balance-client.js";
import { createUsageTickDecision } from "../usage/usage-ticker.js";

interface ConnectionTimerOptions {
  ws: WebSocket;
  session: RealtimeSession;
  sessionEventSink: SessionEventSink;
  usageBalanceClient: UsageBalanceClient;
  heartbeatIntervalMs: number;
  confirmAudio(): Promise<void>;
  failPublicConnection(): void;
  forceQaSupplierStop(): Promise<void>;
  sendRealtime(event: ServerRealtimeEvent): void;
  endRealtimeSession(reason: SessionEndReason, remainingSeconds?: number): Promise<void>;
  enqueueUsage(chain: (previous: Promise<void>) => Promise<void>): void;
}

/** Transport, persistence and account balance timers share the connection's
 * lifetime, but retain the same serial control queue and failure handling. */
export function startRealtimeConnectionTimers(options: ConnectionTimerOptions) {
  const { ws, session, sessionEventSink, usageBalanceClient } = options;
  // A signed QA marker is a wall-clock supplier cutoff, not the ordinary
  // customer's optional active-time limit or 30-second account usage tick.
  const qaDeadline = sessionEventSink.requiresConfirmation && session.claims.publicRuntime
    ? session.claims.qaOneShot?.hardDeadlineAt : undefined;
  const qaDelayMs = qaDeadline === undefined ? undefined : Math.max(0, qaDeadline * 1000 - Date.now());
  const forceQaStop = () => {
    // This must not wait behind a hung finalization or control queue. The
    // original Provider closes its supplier socket before awaiting receipts.
    void options.forceQaSupplierStop().catch(() => undefined);
    options.failPublicConnection();
    ws.terminate();
  };
  const qaCutoff = qaDelayMs === undefined ? undefined : setTimeout(() => {
    if (session.status === "ended" || session.status === "failed") return;
    void options.endRealtimeSession("time_limit", 0).catch(forceQaStop);
  }, qaDelayMs);
  const qaFallback = qaDelayMs === undefined ? undefined : setTimeout(() => {
    if (session.status === "ended" || session.status === "failed") return;
    forceQaStop();
  }, qaDelayMs + 5_000);
  let confirmationInFlight = false;
  const confirmationInterval = sessionEventSink.requiresConfirmation ? setInterval(() => {
    if (confirmationInFlight || ws.readyState !== 1 || !["active", "paused", "ending"].includes(session.status)) return;
    confirmationInFlight = true;
    void options.confirmAudio().catch(error => {
      realtimeLogger.warn({ error, sessionId: session.id }, "Public runtime confirmation failed");
      options.failPublicConnection();
    }).finally(() => { confirmationInFlight = false; });
  }, 1000) : undefined;
  let usageTickInFlight = false;
  const usageInterval = setInterval(() => {
    if (sessionEventSink.requiresConfirmation && ws.readyState !== 1) return;
    if (session.status === "active" || session.status === "paused") {
      void sessionEventSink.touch(session.id, session.status).catch(error => {
        realtimeLogger.warn({ error, sessionId: session.id }, "Realtime session heartbeat sync failed");
      });
    }
    if (session.status !== "active" || usageTickInFlight) return;
    usageTickInFlight = true;
    options.enqueueUsage(previous => previous.then(async () => {
      const balance = await usageBalanceClient.getBalance(session.userId);
      const decision = createUsageTickDecision(session, balance);
      // Wujie account balance, never a supplier free-package balance.
      options.sendRealtime(decision.event);
      if (decision.shouldEnd) {
        await options.endRealtimeSession(decision.endReason ?? "time_limit", decision.event.remainingSeconds);
      }
    }).catch(error => {
      realtimeLogger.warn({ error, sessionId: session.id }, "Realtime usage tick failed");
    }).finally(() => { usageTickInFlight = false; }));
  }, 30_000);
  let heartbeatAlive = true;
  ws.on("pong", () => { heartbeatAlive = true; });
  const heartbeatInterval = setInterval(() => {
    if (!heartbeatAlive) {
      ws.terminate();
      return;
    }
    heartbeatAlive = false;
    ws.ping();
  }, options.heartbeatIntervalMs);
  return () => {
    if (qaCutoff) clearTimeout(qaCutoff);
    if (qaFallback) clearTimeout(qaFallback);
    if (confirmationInterval) clearInterval(confirmationInterval);
    clearInterval(usageInterval);
    clearInterval(heartbeatInterval);
  };
}
