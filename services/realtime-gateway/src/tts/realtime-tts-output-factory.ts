import type { RealtimeEnv } from "../config/env.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import { getSession } from "../sessions/session-manager.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";
import { HttpTtsSynthesizer } from "./http-tts-synthesizer.js";
import { RealtimeTtsOutputQueue } from "./realtime-tts-output.js";

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
