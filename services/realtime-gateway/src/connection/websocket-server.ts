import { WebSocketServer, type WebSocket } from "ws";
import { createServer } from "node:http";
import type { ClientRealtimeEvent, ClientTextSegmentEvent, SessionEndReason, ServerRealtimeEvent } from "@translation/contracts";
import { verifyRealtimeToken } from "../auth/realtime-token-verifier.js";
import { loadEnv } from "../config/env.js";
import { AudioFrameBatcher } from "./audio-frame-batcher.js";
import { clearAudioFrameLog, logAudioFrameReceived } from "../metrics/audio-frame-logger.js";
import { handleGatewayHttpRequest } from "./gateway-health.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { clearTextSegmentLog, logClientTextSegmentReceived } from "../metrics/text-segment-logger.js";
import { parseIncomingEvent } from "../protocol/incoming-event-parser.js";
import { buildError, serializeEvent } from "../protocol/outgoing-event-builder.js";
import { normalizeClientTextLanguage } from "../protocol/client-text-language.js";
import { ProviderRouter } from "../providers/provider-router.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import {
  asrCorrectionTermsForPacks,
  asrHotwordsForTerminology,
  mergeTerminologyWithDomainPacks,
} from "../domain/domain-lexicon.js";
import { createSessionEventSink } from "../sessions/session-event-sink.js";
import { fetchSessionTerminology } from "../sessions/session-terminology.js";
import { createSession, deleteSession, getSession, updateStatus } from "../sessions/session-manager.js";
import { createUsageBalanceClient } from "../usage/usage-balance-client.js";
import { createUsageTickDecision } from "../usage/usage-ticker.js";
import { HttpTtsSynthesizer } from "../tts/http-tts-synthesizer.js";
import { emitRealtimeTtsOutputForSession } from "../tts/realtime-tts-output.js";

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
  const server = new WebSocketServer({ server: httpServer, path: "/realtime" });
  const sessionEventSink = createSessionEventSink(env);
  const usageBalanceClient = createUsageBalanceClient(env);
  const ttsSynthesizer = new HttpTtsSynthesizer(env);

  server.on("connection", async (ws, request) => {
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const token = url.searchParams.get("token");
    const claims = token ? verifyRealtimeToken(token, env.realtimeTokenSecret) : null;
    if (!claims) {
      send(ws, buildError("invalid_token", "Invalid realtime token", {
        stage: "connection",
        retryable: false,
      }));
      ws.close();
      return;
    }

    const session = createSession(claims);
    let provider: RealtimeProvider;
    try {
      provider = router.selectProvider(env);
      const terminology = await loadTerminologyForSession(session, env);
      const asrCorrections = asrCorrectionTermsForPacks(env.domainLexiconPacks);
      const asrHotwords = asrHotwordsForTerminology(terminology, asrCorrections);
      await provider.createSession({
        sessionId: session.id,
        sourceLanguage: session.claims.sourceLanguage,
        targetLanguage: session.claims.targetLanguage,
        autoReverseTargetLanguage: session.claims.autoReverseTargetLanguage,
        voiceOutput: session.claims.voiceOutput,
        terminology,
        asrHotwords,
        asrCorrections,
      });
    } catch {
      send(ws, buildError("provider_unavailable", "Realtime provider is unavailable", {
        sessionId: session.id,
        stage: "provider",
        provider: env.provider,
        retryable: true,
      }));
      ws.close();
      return;
    }

    const sendRealtime = (event: ServerRealtimeEvent) => {
      send(ws, event);
      void sessionEventSink.record(event).catch((error) => {
        realtimeLogger.warn({
          error,
          sessionId: "sessionId" in event ? event.sessionId : session.id,
          eventType: event.type,
        }, "Realtime session event sync failed");
      });
      emitRealtimeTtsOutputForSession({
        event,
        sessionId: session.id,
        voiceOutput: session.claims.voiceOutput,
        voice: session.claims.voice,
        synthesizer: ttsSynthesizer,
        send: sendRealtime,
      });
    };

    sendRealtime({ type: "session.started", sessionId: session.id });
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

    const endRealtimeSession = async (
      reason: SessionEndReason,
      remainingSeconds?: number,
    ) => {
      const activeSession = getSession(session.id);
      if (!activeSession || activeSession.status === "ended") return;
      audioBatcher.stopAccepting();
      await audioBatcher.flush();
      await flushProviderSession(provider, session.id, sendRealtime);
      updateStatus(session.id, "ended");
      sendRealtime({
        type: "session.ended",
        sessionId: session.id,
        reason,
        billableSeconds: session.billableSeconds,
        ...(typeof remainingSeconds === "number" ? { remainingSeconds } : {}),
      });
      ws.close();
    };

    const usageInterval = setInterval(() => {
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

    ws.on("close", async () => {
      clearInterval(usageInterval);
      clearAudioFrameLog(session.id);
      clearTextSegmentLog(session.id);
      ttsSynthesizer.closeSession(session.id);
      await controlQueue.catch(() => undefined);
      await audioBatcher.close();
      await provider.closeSession(session.id);
      deleteSession(session.id, session);
    });
  });

  httpServer.listen(env.port, () => {
    realtimeLogger.info({ port: env.port }, "Realtime gateway started");
  });
  server.on("close", () => httpServer.close());
  return server;
}

async function loadTerminologyForSession(
  session: ReturnType<typeof createSession>,
  env: ReturnType<typeof loadEnv>,
) {
  try {
    return mergeTerminologyWithDomainPacks(
      await fetchSessionTerminology(session.claims, env),
      env.domainLexiconPacks,
    );
  } catch (error) {
    realtimeLogger.warn({
      error,
      sessionId: session.id,
      termbaseId: session.claims.termbaseId,
    }, "Realtime terminology fetch failed");
    return mergeTerminologyWithDomainPacks([], env.domainLexiconPacks);
  }
}

async function handleControlEvent(
  event: Exclude<ClientRealtimeEvent, { type: "audio.frame" } | ClientTextSegmentEvent>,
  sessionId: string,
  provider: RealtimeProvider,
  audioBatcher: AudioFrameBatcher,
  sendEvent: (event: ServerRealtimeEvent) => void,
  endRealtimeSession: (reason: SessionEndReason) => Promise<void>,
) {
  const session = getSession(sessionId);
  if (!session) {
    sendEvent(buildError("bad_event", "Realtime session was not found", {
      sessionId,
      stage: "session",
      retryable: false,
    }));
    return;
  }

  if (event.type === "session.pause") {
    audioBatcher.pauseAccepting();
    await audioBatcher.flush();
    await flushProviderSession(provider, session.id, sendEvent);
    updateStatus(session.id, "paused");
    sendEvent({ type: "session.paused", sessionId: session.id });
    return;
  }

  if (event.type === "session.resume") {
    updateStatus(session.id, "active");
    audioBatcher.resumeAccepting();
    return;
  }

  if (event.type === "session.end") {
    await endRealtimeSession("client_request");
  }
}

async function handleTextSegment(
  event: ClientTextSegmentEvent,
  expectedSessionId: string,
  provider: RealtimeProvider,
  sendEvent: (event: ServerRealtimeEvent) => void,
) {
  const session = getSession(expectedSessionId);
  if (!session || event.sessionId !== expectedSessionId) {
    sendEvent(buildError("bad_event", "Realtime session was not found", {
      sessionId: expectedSessionId,
      stage: "session",
      retryable: false,
    }));
    return;
  }
  if (session.status !== "active") return;
  if (!provider.sendText) {
    sendEvent(buildError("bad_event", "Realtime provider does not accept text segments", {
      sessionId: expectedSessionId,
      stage: "provider",
      provider: provider.name,
      retryable: false,
    }));
    return;
  }
  const language = normalizeClientTextLanguage(event.language, session.claims.targetLanguage);
  const normalizedEvent: ClientTextSegmentEvent = { ...event, language };
  logClientTextSegmentReceived(normalizedEvent);

  for await (const outgoing of provider.sendText({
    sessionId: normalizedEvent.sessionId,
    segmentId: normalizedEvent.segmentId,
    text: normalizedEvent.text,
    language: normalizedEvent.language,
    isFinal: normalizedEvent.isFinal !== false,
    confidence: normalizedEvent.confidence,
  })) {
    sendEvent(outgoing);
  }
}

async function flushProviderSession(
  provider: RealtimeProvider,
  sessionId: string,
  sendEvent: (event: ServerRealtimeEvent) => void,
) {
  if (!provider.flushSession) return;
  for await (const outgoing of provider.flushSession(sessionId)) sendEvent(outgoing);
}
