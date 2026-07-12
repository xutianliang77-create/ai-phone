import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "node:http";
import type { SessionEndReason, ServerRealtimeEvent } from "@translation/contracts";
import { verifyRealtimeToken } from "../auth/realtime-token-verifier.js";
import { loadEnv } from "../config/env.js";
import { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { clearAudioFrameLog, logAudioFrameReceived } from "../metrics/audio-frame-logger.js";
import { handleGatewayHttpRequest } from "./gateway-health.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { clearTextSegmentLog } from "../metrics/text-segment-logger.js";
import { parseIncomingEvent } from "../protocol/incoming-event-parser.js";
import { buildError, serializeEvent } from "../protocol/outgoing-event-builder.js";
import { ProviderRouter } from "../providers/provider-router.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { asrCorrectionTermsForPacks, asrHotwordsForTerminology } from "../domain/domain-lexicon.js";
import { createSessionEventSink } from "../sessions/session-event-sink.js";
import {
  domainLexiconPacksForSession,
  loadTerminologyForSession,
} from "../sessions/session-domain-terminology.js";
import { attachSession, confirmSessionConnection, deleteSession, getSession, sessionBillableSeconds, transitionStatus } from "../sessions/session-manager.js";
import { createUsageBalanceClient } from "../usage/usage-balance-client.js";
import { createUsageTickDecision } from "../usage/usage-ticker.js";
import { extractRealtimeConnectionToken, realtimeProtocol } from "../auth/realtime-connection-token.js";
import { HttpTtsSynthesizer } from "../tts/http-tts-synthesizer.js";
import { RealtimeTtsOutputQueue } from "../tts/realtime-tts-output.js";
import { handleControlEvent } from "./session-control-handler.js";
import { RealtimeSessionFinalizer } from "./realtime-session-finalizer.js";
import { RealtimeConnectionCleanup } from "./realtime-connection-cleanup.js";
import { DisconnectFinalizerRegistry } from "../sessions/disconnect-finalizer-registry.js";
import { RealtimeEventDispatcher } from "./realtime-event-dispatcher.js";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";
import {
  logSpeakerAttributionConfigured,
  resolveSpeakerAttribution,
} from "./speaker-attribution-config.js";
import { handleTextSegment } from "./client-text-segment-handler.js";
import { endpointModeForRealtimeMode } from "./realtime-endpoint-mode.js";

const router = new ProviderRouter();
export { normalizeClientTextLanguage } from "../protocol/client-text-language.js";

function send(ws: WebSocket, event: ServerRealtimeEvent) {
  if (ws.readyState === 1) ws.send(serializeEvent(event));
}

export function startWebSocketServer() {
  const env = loadEnv();
  const httpServer = createServer((request, response) => {
    handleGatewayHttpRequest(request, response, env);
  });
  const server = new WebSocketServer({
    server: httpServer,
    path: "/realtime",
    handleProtocols: (protocols) =>
      protocols.has(realtimeProtocol) ? realtimeProtocol : false,
  });
  const sessionEventSink = createSessionEventSink(env);
  const usageBalanceClient = createUsageBalanceClient(env);
  const disconnectFinalizers = new DisconnectFinalizerRegistry(
    env.disconnectGraceMs,
    (error) => realtimeLogger.error({ error }, "Deferred session finalization failed"),
  );

  server.on("connection", async (ws, request) => {
    const token = extractRealtimeConnectionToken(
      request,
      env.allowQueryToken === true,
    );
    const claims = token ? verifyRealtimeToken(token, env.realtimeTokenSecret) : null;
    if (!claims) {
      send(ws, buildError("invalid_token", "Invalid realtime token", {
        stage: "connection",
        retryable: false,
      }));
      ws.close();
      return;
    }

    const attachment = attachSession(claims);
    if (!attachment) {
      send(ws, buildError("bad_event", "Realtime session cannot be resumed", {
        sessionId: claims.sessionId,
        stage: "session",
        retryable: false,
      }));
      ws.close();
      return;
    }
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
      send(ws, buildError("provider_unavailable", "Realtime provider is unavailable", {
        sessionId: session.id,
        stage: "provider",
        provider: env.provider,
        retryable: true,
      }));
      ws.close();
      return;
    }

    const flushTracker = new RealtimeFlushTracker();
    const ttsOutputQueue = new RealtimeTtsOutputQueue({
      sessionId: session.id,
      voiceOutput: session.claims.voiceOutput,
      voice: session.claims.voice,
      synthesizer: new HttpTtsSynthesizer(env),
      isSessionActive: () => getSession(session.id)?.status === "active",
    });
    const eventDispatcher = new RealtimeEventDispatcher({
      sendClient: (event) => send(ws, event),
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
    if (resumed) send(ws, startedEvent);
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

    ws.on("message", (data) => {
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
        const activeSession = getSession(session.id);
        if (activeSession?.status === "active") {
          logAudioFrameReceived(event);
          audioBatcher.enqueue(event);
        }
        return;
      }

      if (event.type === "client.text.segment") {
        controlQueue = controlQueue
          .then(() => handleTextSegment(event, session.id, provider, sendRealtime))
          .catch((error) => {
            realtimeLogger.error({ error, sessionId: session.id }, "Realtime text processing failed");
            sendRealtime(buildError("provider_unavailable", "Realtime text processing failed", {
              sessionId: session.id,
              stage: "translation",
              provider: provider.name,
              retryable: true,
            }));
          });
        return;
      }

      controlQueue = controlQueue
        .then(() =>
          handleControlEvent(
            event,
            session.id,
            provider,
            audioBatcher,
            sendRealtime,
            endRealtimeSession,
          ),
        )
        .catch((error) => {
          realtimeLogger.error({ error, sessionId: session.id }, "Realtime event processing failed");
          sendRealtime(buildError("provider_unavailable", "Realtime event processing failed", {
            sessionId: session.id,
            stage: "session",
            provider: provider.name,
            retryable: true,
          }));
        });
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

  httpServer.listen(env.port, () => {
    realtimeLogger.info({ port: env.port }, "Realtime gateway started");
  });
  server.on("close", () => {
    disconnectFinalizers.close();
    httpServer.close();
  });
  return server;
}
