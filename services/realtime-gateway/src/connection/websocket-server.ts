import type { SessionEndReason } from "@translation/contracts";
import { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { clearAudioFrameLog, logAudioFrameReceived } from "../metrics/audio-frame-logger.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { clearTextSegmentLog } from "../metrics/text-segment-logger.js";
import { parseIncomingEvent } from "../protocol/incoming-event-parser.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import { ProviderRouter } from "../providers/provider-router.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { asrCorrectionTermsForPacks, asrHotwordsForTerminology } from "../domain/domain-lexicon.js";
import { domainLexiconPacksForSession, loadTerminologyForSession } from "../sessions/session-domain-terminology.js";
import { confirmSessionConnection, deleteSession, getSession, sessionBillableSeconds, transitionStatus } from "../sessions/session-manager.js";
import { createUsageTickDecision } from "../usage/usage-ticker.js";
import { createRealtimeTtsOutputQueue } from "../tts/realtime-tts-output-factory.js";
import { handleControlEvent } from "./session-control-handler.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeConnectionCleanup } from "./realtime-connection-cleanup.js";
import { RealtimeEventDispatcher } from "./realtime-event-dispatcher.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";
import { logSpeakerAttributionConfigured, resolveSpeakerAttribution } from "./speaker-attribution-config.js";
import { handleTextSegment } from "./client-text-segment-handler.js";
import { endpointModeForRealtimeMode } from "./realtime-endpoint-mode.js";
import { admitRealtimeConnection, sendRealtimeEvent } from "./realtime-connection-admission.js";
import { createRealtimeServerRuntime } from "./realtime-server-runtime.js";

const router = new ProviderRouter();
export { normalizeClientTextLanguage } from "../protocol/client-text-language.js";

export function startWebSocketServer() {
  const {
    env,
    protection,
    dependencyReadiness,
    httpServer,
    server,
    sessionEventSink,
    usageBalanceClient,
    disconnectFinalizers,
  } = createRealtimeServerRuntime();

  server.on("connection", async (ws, request) => {
    const attachment = admitRealtimeConnection(ws, request, env);
    if (!attachment) return;
    const { session, generation, resumed } = attachment;
    let provider: RealtimeProvider;
    try {
      provider = router.selectProvider(env);
      const domainLexiconPacks = domainLexiconPacksForSession(session, env);
      const terminology = await loadTerminologyForSession(session, env);
      const asrCorrections = asrCorrectionTermsForPacks(domainLexiconPacks);
      const asrHotwords = asrHotwordsForTerminology(terminology, asrCorrections);
      const speakerAttribution = resolveSpeakerAttribution(session.claims);
      await provider.createSession({
        sessionId: session.id,
        userId: session.userId,
        asrEndpointMode: session.claims.asrEndpointMode ??
          endpointModeForRealtimeMode(session.claims.mode),
        sourceLanguage: session.claims.sourceLanguage,
        targetLanguage: session.claims.targetLanguage,
        autoReverseTargetLanguage: session.claims.autoReverseTargetLanguage,
        voiceOutput: session.claims.voiceOutput,
        speakerAttribution,
        terminology,
        asrHotwords,
        asrCorrections,
      });
      logSpeakerAttributionConfigured(env, session, speakerAttribution);
    } catch {
      const current = getSession(session.id);
      if (current === session && current.connectionGeneration === generation) {
        transitionStatus(session.id, "failed");
        await sessionEventSink.record({
          type: "session.ended",
          sessionId: session.id,
          reason: "connection_error",
          billableSeconds: sessionBillableSeconds(session),
        }).catch(() => undefined);
        deleteSession(session.id, session);
      }
      sendRealtimeEvent(ws, buildError("provider_unavailable", "Realtime provider is unavailable", {
        sessionId: session.id,
        stage: "provider",
        provider: env.provider,
        retryable: true,
      }));
      ws.close();
      return;
    }

    const flushTracker = new RealtimeFlushTracker();
    const ttsOutputQueue = createRealtimeTtsOutputQueue(env, session);
    const eventDispatcher = new RealtimeEventDispatcher({
      sendClient: (event) => sendRealtimeEvent(ws, event),
      eventSink: sessionEventSink,
      onSyncError: (event, error) => {
        realtimeLogger.warn({
          error,
          sessionId: "sessionId" in event ? event.sessionId : session.id,
          eventType: event.type,
        }, "Realtime session event sync failed");
      },
      afterSend: (event) => {
        flushTracker.record(event);
        if (event.type === "session.paused") ttsOutputQueue.cancelPending();
        else ttsOutputQueue.enqueue(event, eventDispatcher.send);
      },
    });
    const sendRealtime = eventDispatcher.send;

    const startedEvent = { type: "session.started", sessionId: session.id } as const;
    if (resumed) sendRealtimeEvent(ws, startedEvent);
    else sendRealtime(startedEvent);
    let controlQueue = Promise.resolve();
    let usageTickInFlight = false;
    const audioBatcher = new AudioFrameBatcher({
      sessionId: session.id,
      provider,
      send: sendRealtime,
      onError: (error) => {
        realtimeLogger.error({ error, sessionId: session.id }, "Realtime audio processing failed");
        sendRealtime(buildError("provider_unavailable", "Realtime audio processing failed", {
          sessionId: session.id,
          stage: "asr",
          provider: provider.name,
          retryable: true,
        }));
      },
      maxPendingAudioMs: env.maxPendingAudioMs,
    });
    const finalizer = new RealtimeSessionFinalizer({
      sessionId: session.id,
      provider,
      audioBatcher,
      send: sendRealtime,
      drainSessionSync: () => eventDispatcher.drain(),
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
      await finalizer.finalize(reason, remainingSeconds);
      if (ws.readyState === 1) ws.close();
    };

    const usageInterval = setInterval(() => {
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

      if (event.sessionId === session.id &&
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
        }
        return;
      }

      if (event.type === "client.text.segment") {
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

      if (!enqueueControl(
        () =>
          handleControlEvent(
            event,
            session.id,
            provider,
            audioBatcher,
            sendRealtime,
            endRealtimeSession,
          ),
        (error) => {
          realtimeLogger.error({ error, sessionId: session.id }, "Realtime event processing failed");
          sendRealtime(buildError("provider_unavailable", "Realtime event processing failed", {
            sessionId: session.id,
            stage: "session",
            provider: provider.name,
            retryable: true,
          }));
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
      clearInterval(usageInterval);
      clearInterval(heartbeatInterval);
      clearAudioFrameLog(session.id);
      clearTextSegmentLog(session.id);
      ttsOutputQueue.close();
      await controlQueue.catch(() => undefined);
      const reason: SessionEndReason = connectionError
        ? "connection_error"
        : "connection_closed";
      await connectionCleanup.run(reason);
    };
    ws.on("error", (error) => {
      connectionError = true;
      realtimeLogger.warn({ error, sessionId: session.id },
        "Realtime client connection failed");
      void cleanupConnection();
    });
    ws.on("close", () => { void cleanupConnection(); });
  });

  httpServer.listen(env.port, env.host, () => {
    realtimeLogger.info({ host: env.host, port: env.port }, "Realtime gateway started");
  });
  httpServer.on("close", () => {
    void protection.close();
    dependencyReadiness.close();
    disconnectFinalizers.close();
    server.close();
  });
  return httpServer;
}
