import {setupRealtimeConnection} from "./realtime-connection-setup.js";
import type {PublicGatewayRuntimeOptions} from "./configured-public-connection.js";
import type { SessionEndReason } from "@translation/contracts";
import { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { clearAudioFrameLog, logAudioFrameReceived } from "../metrics/audio-frame-logger.js";
import { loggableError, realtimeLogger } from "../metrics/realtime-metrics.js";
import { clearTextSegmentLog } from "../metrics/text-segment-logger.js";
import { parseIncomingEvent } from "../protocol/incoming-event-parser.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import { confirmSessionConnection, getSession } from "../sessions/session-manager.js";
import { createUsageTickDecision } from "../usage/usage-ticker.js";
import { handleControlEvent } from "./session-control-handler.js";
import {handleAudioBoundary} from "./audio-boundary-control.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeConnectionCleanup } from "./realtime-connection-cleanup.js";
import { RealtimeEventDispatcher } from "./realtime-event-dispatcher.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";
import { handleTextSegment } from "./client-text-segment-handler.js";
import { sendRealtimeEvent } from "./realtime-connection-admission.js";
import { createRealtimeServerRuntime, listenRealtimeServerRuntime } from "./realtime-server-runtime.js";
export { normalizeClientTextLanguage } from "../protocol/client-text-language.js";
export function startWebSocketServer(options:{publicRuntime?:PublicGatewayRuntimeOptions}={}) {
  const runtime = createRealtimeServerRuntime();
  const publicRuntime=options.publicRuntime?{...options.publicRuntime}:undefined;
  const {
    env,
    protection,
    server,
    usageBalanceClient,
    disconnectFinalizers,
  } = runtime;
  server.on("connection", async (ws, request) => {
    const configured=await setupRealtimeConnection(runtime,ws,request,publicRuntime);
    if(!configured)return;
    const {session,generation,resumed,provider,sessionEventSink,ttsOutputQueue}=configured;
    const flushTracker = new RealtimeFlushTracker();
    let outputSuppressed=false,recoveryResumeMatched=!configured.publicRecoveryConnection,recoveryResumeConfirmed=!configured.publicRecoveryConnection,
      recoveryFirstAudioAccepted=!configured.publicRecoveryConnection;
    const eventDispatcher = new RealtimeEventDispatcher({
      sendClient: (event) => sendRealtimeEvent(ws, event),
      eventSink: sessionEventSink,
      onSyncError: (event, error) => {
        realtimeLogger.warn({
          error,
          sessionId: "sessionId" in event ? event.sessionId : session.id,
          eventType: event.type,
        }, "Realtime session event sync failed");
        failPublicConnection();
      },
      afterSend: (event) => {
        if(event.type==="session.started")configured.markStarted();
        flushTracker.record(event);
        if (event.type === "session.paused") {if(sessionEventSink.requiresConfirmation)outputSuppressed=true;ttsOutputQueue.cancelPending();}
        else {if(event.type==="session.resumed"){outputSuppressed=false;if(configured.publicRecoveryConnection&&recoveryResumeMatched)recoveryResumeConfirmed=true;}if(!outputSuppressed)ttsOutputQueue.enqueue(event, eventDispatcher.send);}
      },
    });
    const sendRealtime = eventDispatcher.send;
    const unsubscribeProvider=provider.setEventListener?.(session.id,event=>{
      if(ws.readyState===1&&!outputSuppressed&&getSession(session.id)?.connectionGeneration===generation&&getSession(session.id)?.status==="active")sendRealtime(event);
    })??(()=>{});
    const confirmAudio=()=>sessionEventSink.confirmAudio?.()??Promise.reject(Error("public_audio_confirmation_required"));
    const startedEvent = { type: "session.started", sessionId: session.id } as const;
    if (resumed) sendRealtimeEvent(ws, startedEvent);
    else sendRealtime(startedEvent);
    if(configured.publicRecoveryConnection&&configured.recoveryBridge){
      sendRealtimeEvent(ws,{type:"session.recovery.ready",sessionId:session.id,...configured.recoveryBridge});
    }
    let controlQueue = Promise.resolve();
    let usageTickInFlight = false;
    const audioBatcher = new AudioFrameBatcher({
      sessionId: session.id,
      provider,
      acceptFrame: sessionEventSink.acceptAudio?.bind(sessionEventSink),
      beforeSend:sessionEventSink.requiresConfirmation?()=>confirmAudio():undefined,
      send: sendRealtime,
      onError: (error) => {
        realtimeLogger.error({ error: loggableError(error),
          sessionId: session.id }, "Realtime audio processing failed");
        sendRealtime(buildError("provider_unavailable", "Realtime audio processing failed", {
          sessionId: session.id,
          stage: "asr",
          provider: provider.name,
          retryable: true,
        }));
        failPublicConnection();
      },
      maxPendingAudioMs: env.maxPendingAudioMs,
    });
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider,
      audioBatcher,
      send: sendRealtime,
      drainSessionSync: () => eventDispatcher.drain(),
      confirmed:sessionEventSink.requiresConfirmation?{beforeFlush:confirmAudio}:undefined,
      ttsOutput:sessionEventSink.requiresConfirmation?ttsOutputQueue:undefined,
      flushTracker,
      onError: (stage, error) => {
        realtimeLogger.warn({ error, stage, sessionId: session.id },
          "Realtime pipeline flush failed during finalization");
      },
    });

    const endRealtimeSession = async (
      reason: SessionEndReason,
      remainingSeconds?: number,
    ) => {
      if(sessionEventSink.requiresConfirmation){outputSuppressed=true;ttsOutputQueue.suspend();audioBatcher.stopAccepting();}
      try{await finalizer.finalize(reason, remainingSeconds);}finally{if(sessionEventSink.requiresConfirmation&&ws.readyState===1)ws.close();}
      if (ws.readyState === 1) ws.close();
    };
    function failPublicConnection(){
      if(!sessionEventSink.requiresConfirmation)return;
      outputSuppressed=true;ttsOutputQueue.suspend();audioBatcher.stopAccepting();
      if(ws.readyState===1)ws.close(1011,"public_pipeline_unconfirmed");
    }

    let confirmationInFlight=false;
    const confirmationInterval=sessionEventSink.requiresConfirmation?setInterval(()=>{
      if(confirmationInFlight||ws.readyState!==1||!["active","paused","ending"].includes(session.status))return;
      confirmationInFlight=true;void confirmAudio().catch(error=>{realtimeLogger.warn({error,sessionId:session.id},"Public runtime confirmation failed");failPublicConnection();})
        .finally(()=>{confirmationInFlight=false;});
    },1000):undefined;
    const usageInterval = setInterval(() => {
      if(sessionEventSink.requiresConfirmation&&ws.readyState!==1)return;
      if (session.status === "active" || session.status === "paused") {
        void sessionEventSink.touch(session.id, session.status).catch((error) => {
          realtimeLogger.warn({ error, sessionId: session.id },
            "Realtime session heartbeat sync failed");
        });
      }
      if (session.status !== "active" || usageTickInFlight) return;
      usageTickInFlight = true;
      controlQueue = controlQueue
        .then(async () => {
          const balance = await usageBalanceClient.getBalance(session.userId);
          const decision = createUsageTickDecision(session, balance);
          sendRealtime(decision.event);
          if (decision.shouldEnd) {
            await endRealtimeSession(
              decision.endReason ?? "time_limit",
              decision.event.remainingSeconds,
            );
          }
        })
        .catch((error) => {
          realtimeLogger.warn({ error, sessionId: session.id }, "Realtime usage tick failed");
        })
        .finally(() => {
          usageTickInFlight = false;
        });
    }, 30_000);
    const messageRateGuard = protection.createMessageGuard();
    let rateLimited = false;
    let pendingControlEvents = 0;
    const enqueueControl = (
      run: () => Promise<void>,
      onError: (error: unknown) => void,
    ) => {
      if (pendingControlEvents >= env.maxPendingControlEvents) return false;
      pendingControlEvents += 1;
      controlQueue = controlQueue
        .then(run)
        .catch(onError)
        .finally(() => {
          pendingControlEvents = Math.max(0, pendingControlEvents - 1);
        });
      return true;
    };
    ws.on("message", (data) => {
      if (rateLimited) return;
      if (!messageRateGuard.consume("message")) {
        rateLimited = true;
        sendRealtime(buildError("bad_event", "Realtime message rate limit exceeded", {
          sessionId: session.id,
          stage: "connection",
          retryable: true,
        }));
        ws.close(1008, "message_rate_limited");
        return;
      }
      const event = parseIncomingEvent(data.toString());
      if (!event) {
        sendRealtime(buildError("bad_event", "Malformed realtime event", {
          sessionId: session.id,
          stage: "connection",
          retryable: false,
        }));
        return;
      }
      if(sessionEventSink.requiresConfirmation&&getSession(session.id)?.connectionGeneration!==generation)return;

      if(configured.publicRecoveryConnection){
        const bridge=configured.recoveryBridge;
        if(!bridge){sendRealtime(buildError("bad_event","Public recovery bridge is unavailable",{sessionId:session.id,stage:"session",retryable:false}));return;}
        if(event.type==="session.resume"){
          if(event.recovery?.lastAcceptedSample!==bridge.lastAcceptedSample||event.recovery?.nextSequence!==bridge.nextSequence){
            sendRealtime(buildError("bad_event","Public recovery resume bridge does not match the trusted watermark",{sessionId:session.id,stage:"session",retryable:false}));
            return;
          }
          recoveryResumeMatched=true;
        }
        if(event.type==="audio.frame"&&(!recoveryResumeConfirmed||(!recoveryFirstAudioAccepted&&event.sequence!==bridge.nextSequence))){
          sendRealtime(buildError("bad_event","Public recovery audio sequence does not match the trusted watermark",{sessionId:session.id,stage:"asr",retryable:false}));
          return;
        }
      }

      if (event.sessionId === session.id && (!configured.publicRecoveryConnection||event.type==="session.resume") &&
          confirmSessionConnection(session.id, generation)) {
        disconnectFinalizers.cancel(session.id);
      }

      if (event.type === "audio.frame") {
        if (!messageRateGuard.consume("audio")) {
          rateLimited = true;
          sendRealtime(buildError("bad_event", "Realtime audio frame rate limit exceeded", {
            sessionId: session.id,
            stage: "connection",
            retryable: true,
          }));
          ws.close(1008, "audio_rate_limited");
          return;
        }
        const activeSession = getSession(session.id);
        if (activeSession?.status === "active") {
          logAudioFrameReceived(event);
          audioBatcher.enqueue(event);
          if(configured.publicRecoveryConnection)recoveryFirstAudioAccepted=true;
        }
        return;
      }

      if (event.type === "client.text.segment") {
        if(configured.publicConnection){sendRealtime(buildError("bad_event","This public session requires audio input",{sessionId:session.id,retryable:false}));failPublicConnection();return;}
        if (!enqueueControl(
          () => handleTextSegment(event, session.id, provider, sendRealtime),
          (error) => {
            realtimeLogger.error({ error, sessionId: session.id }, "Realtime text processing failed");
            sendRealtime(buildError("provider_unavailable", "Realtime text processing failed", {
              sessionId: session.id,
              stage: "translation",
              provider: provider.name,
              retryable: true,
            }));
          },
        )) closeForControlBackpressure();
        return;
      }

      if(event.type==="audio.boundary"){
        if(pendingControlEvents>=env.maxPendingControlEvents){closeForControlBackpressure();return;}
        const boundary=handleAudioBoundary(event,{sessionId:session.id,confirmed:!!sessionEventSink.requiresConfirmation,batcher:audioBatcher,provider,
          beforeFlush:confirmAudio,drain:()=>eventDispatcher.drain(),send:sendRealtime,onFailure:failPublicConnection});
        enqueueControl(()=>boundary,()=>{});return;
      }
      if(sessionEventSink.requiresConfirmation&&event.sessionId===session.id&&(event.type==="session.pause"||event.type==="session.end")){
        outputSuppressed=true;ttsOutputQueue.suspend();audioBatcher.pauseAccepting();
      }

      if (!enqueueControl(
        () =>
          handleControlEvent(
            event,
            session.id,
            provider,
            audioBatcher,
            sendRealtime,
            endRealtimeSession, ttsOutputQueue,
            sessionEventSink.requiresConfirmation?{beforeFlush:confirmAudio,drain:()=>eventDispatcher.drain()}:undefined,
          ),
        (error) => {
          realtimeLogger.error({ error, sessionId: session.id }, "Realtime event processing failed");
          sendRealtime(buildError("provider_unavailable", "Realtime event processing failed", {
            sessionId: session.id,
            stage: "session",
            provider: provider.name,
            retryable: true,
          }));
          failPublicConnection();
        },
      )) closeForControlBackpressure();

      function closeForControlBackpressure() {
        rateLimited = true;
        sendRealtime(buildError("provider_unavailable", "Realtime control queue capacity reached", {
          sessionId: session.id,
          stage: "connection",
          retryable: true,
        }));
        ws.close(1013, "control_queue_capacity_reached");
      }
    });

    let connectionError = false;
    let heartbeatAlive = true;
    ws.on("pong", () => { heartbeatAlive = true; });
    const heartbeatInterval = setInterval(() => {
      if (!heartbeatAlive) {
        ws.terminate();
        return;
      }
      heartbeatAlive = false;
      ws.ping();
    }, env.heartbeatIntervalMs);
    const connectionCleanup = new RealtimeConnectionCleanup({
      session,
      generation,
      finalizer,
      provider,
      sessionSync: eventDispatcher,
      publicImmediateFinalization:configured.publicConnection,
      checkpointDisconnect:configured.checkpointDisconnect,
      retainPublicRecovery:configured.retainPublicRecovery,
      releaseRetainedRecovery:configured.releaseRetainedRecovery,
      disconnectFinalizers,
      closeClient: () => { if (ws.readyState === 1) ws.close(); },
      onError: (stage, error) => realtimeLogger.warn(
        { error, stage, sessionId: session.id },
        "Realtime connection cleanup failed",
      ),
    });
    if (resumed && session.disconnectDeadlineAt !== undefined) {
      connectionCleanup.scheduleDeferredFinalization("connection_closed");
    }
    const cleanupConnection = async () => {
      if(configured.publicConnection){outputSuppressed=true;audioBatcher.stopAccepting();ttsOutputQueue.suspend();}
      unsubscribeProvider();if(confirmationInterval)clearInterval(confirmationInterval);
      clearInterval(usageInterval);
      clearInterval(heartbeatInterval);
      clearAudioFrameLog(session.id);
      clearTextSegmentLog(session.id);
      await controlQueue.catch(() => undefined);
      const reason: SessionEndReason = connectionError
        ? "connection_error"
        : "connection_closed";
      await connectionCleanup.run(reason);
      if(!connectionCleanup.retainedPublicRecovery)ttsOutputQueue.close();
    };
    ws.on("error", (error) => {
      connectionError = true;
      realtimeLogger.warn({ error, sessionId: session.id },
        "Realtime client connection failed");
      void cleanupConnection();
    });
    ws.on("close", () => { void cleanupConnection(); });
  });

  return listenRealtimeServerRuntime(runtime);
}
