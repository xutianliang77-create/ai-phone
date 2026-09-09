import type { RealtimeEnv } from "../config/env.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { getSession } from "../sessions/session-manager.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";
import { RealtimeTtsOutputQueue } from "./realtime-tts-output.js";
import {configuredPublicTts,type ConfiguredPublicTtsOptions} from "./configured-public-tts.js";

/** Internal, session-scoped public output assembly; no legacy env/voice fallback.
 * Whole public connection admission remains gated until all components qualify. */
export function createConfiguredPublicTtsOutputQueue(options:ConfiguredPublicTtsOptions,isSessionActive:()=>boolean,maxPendingOutputs=32) {
  if(!Number.isSafeInteger(maxPendingOutputs)||maxPendingOutputs<1||maxPendingOutputs>32)throw Error("public_tts_queue_capacity_invalid");
  const boundVoice=options.snapshot.components.tts?.voice;
  return new RealtimeTtsOutputQueue({sessionId:options.sessionId,voiceOutput:true,synthesizer:configuredPublicTts(options),
    isSessionActive,maxPendingOutputs,acceptVoice:(_enabled,presetId)=>presetId===undefined||presetId===boundVoice});
}

export function createRealtimeTtsOutputQueue(
  env: RealtimeEnv,
  session: RealtimeSession,
) {
  return new RealtimeTtsOutputQueue({
    sessionId: session.id,
    voiceOutput: session.voiceOutputEnabled ?? session.claims.voiceOutput,
    voice: session.voice ?? session.claims.voice,
    synthesizer: new HttpTtsSynthesizer(env),
    isSessionActive: () => getSession(session.id)?.status === "active",
    maxPendingOutputs: env.maxPendingTtsOutputs,
    onDrop: (event) => realtimeLogger.warn({
      sessionId: session.id,
      segmentId: event.segmentId,
      maxPendingOutputs: env.maxPendingTtsOutputs,
    }, "Dropped realtime TTS output under backpressure"),
  });
}
