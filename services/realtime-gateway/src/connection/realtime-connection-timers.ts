import type { ServerRealtimeEvent, SessionEndReason } from "@translation/contracts";
import type { WebSocket } from "ws";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import type { SessionEventSink } from "../sessions/session-event-sink.js";
import type { UsageBalanceClient } from "../usage/usage-balance-client.js";
import type {UsageBalanceSnapshot} from "../usage/usage-ticker.js";
import { createUsageTickDecision } from "../usage/usage-ticker.js";
import {sessionBillableSeconds} from "../sessions/session-manager.js";

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
  const publicUsage=sessionEventSink.requiresConfirmation&&session.claims.publicRuntime!==undefined;
  const initialHold=session.claims.holdSeconds;
  let publicAllowance:UsageBalanceSnapshot|null=publicUsage&&Number.isSafeInteger(initialHold)&&initialHold!>0
    ? {authorizedSeconds:initialHold!,remainingSeconds:initialHold!,availableSeconds:0}:null;
  let accountStopStarted=false,allowanceInFlight=false;
  const stopForAccount=async(reason:SessionEndReason,remainingSeconds=0)=>{
    if(accountStopStarted)return;
    accountStopStarted=true;
    let timeout:ReturnType<typeof setTimeout>|undefined;
    try{
      await Promise.race([options.endRealtimeSession(reason,remainingSeconds),
        new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error("account_stop_timeout")),5000);})]);
    }catch(error){
      realtimeLogger.warn({error,sessionId:session.id},"Public account stop was not confirmed");
      options.failPublicConnection();
    }finally{if(timeout)clearTimeout(timeout);}
  };
  const allowanceInterval=publicUsage?setInterval(()=>{
    if(ws.readyState!==1||session.status!=="active"||allowanceInFlight||accountStopStarted||
      qaDeadline!==undefined&&Date.now()>=qaDeadline*1000)return;
    allowanceInFlight=true;
    options.enqueueUsage(previous=>previous.then(async()=>{
      if(ws.readyState!==1||session.status!=="active"||accountStopStarted)return;
      const observed=sessionBillableSeconds(session),current=publicAllowance?.authorizedSeconds??0;
      if(current>0&&observed>current){await stopForAccount("connection_error");return;}
      const target=Math.min(session.claims.maxDurationSeconds??Infinity,observed+30,current+30);
      const next=await usageBalanceClient.reserveAllowance?.(session.id,target)??null;
      if(!next||!Number.isSafeInteger(next.authorizedSeconds)||next.authorizedSeconds!<1||
        !Number.isSafeInteger(next.remainingSeconds)||next.remainingSeconds<0||
        next.authorizedSeconds!<observed){await stopForAccount("connection_error");return;}
      publicAllowance=next;
      if(next.remainingSeconds===0||observed>=next.authorizedSeconds!){
        await stopForAccount("quota_exhausted",0);
      }
    }).catch(error=>{
      realtimeLogger.warn({error,sessionId:session.id},"Public allowance check failed");
      options.failPublicConnection();
    }).finally(()=>{allowanceInFlight=false;}));
  },10_000):undefined;
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
      if(session.status!=="active"||accountStopStarted)return;
      const balance = publicUsage?publicAllowance:await usageBalanceClient.getBalance(session.userId);
      const decision = createUsageTickDecision(session, balance);
      // Wujie account balance, never a supplier free-package balance.
      options.sendRealtime(decision.event);
      if (decision.shouldEnd) {
        if(publicUsage)await stopForAccount(decision.endReason??"connection_error",decision.event.remainingSeconds);
        else await options.endRealtimeSession(decision.endReason ?? "time_limit", decision.event.remainingSeconds);
      }
    }).catch(error => {
      realtimeLogger.warn({ error, sessionId: session.id }, "Realtime usage tick failed");
      if(publicUsage)options.failPublicConnection();
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
    if (allowanceInterval) clearInterval(allowanceInterval);
    clearInterval(usageInterval);
    clearInterval(heartbeatInterval);
  };
}
