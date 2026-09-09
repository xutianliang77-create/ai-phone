import type WebSocket from "ws";
import type { createRealtimeServerRuntime } from "./realtime-server-runtime.js";
import { getSession, transitionStatus, sessionBillableSeconds, deleteSession } from "../sessions/session-manager.js";
import { sendRealtimeEvent } from "./realtime-connection-admission.js";
import { buildError } from "../protocol/outgoing-event-builder.js";
import type { RealtimeProvider } from "../providers/realtime-provider.js";
import { asrCorrectionTermsForPacks, asrHotwordsForTerminology } from "../domain/domain-lexicon.js";
import { domainLexiconPacksForSession, loadTerminologyForSession } from "../sessions/session-domain-terminology.js";
import { logSpeakerAttributionConfigured, resolveSpeakerAttribution } from "./speaker-attribution-config.js";
import { endpointModeForRealtimeMode } from "./realtime-endpoint-mode.js";

export async function configureRealtimeProvider(provider: RealtimeProvider,
  env: Parameters<typeof domainLexiconPacksForSession>[1],
  session: Parameters<typeof domainLexiconPacksForSession>[0]) {
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
    voiceOutput: session.voiceOutputEnabled ?? session.claims.voiceOutput,
    speakerAttribution,
    terminology,
    asrHotwords,
    asrCorrections,
  });
  logSpeakerAttributionConfigured(env, session, speakerAttribution);
}

export async function reportProviderSetupFailure(runtime:ReturnType<typeof createRealtimeServerRuntime>, ws:WebSocket,
  session:Parameters<typeof domainLexiconPacksForSession>[0],generation:number,providerFailureStage:"provider"|"asr"|"translation") {
  const {env,sessionEventSink}=runtime;
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
    stage: providerFailureStage,
    provider: env.provider,
    retryable: true,
  }));
  ws.close();
}
