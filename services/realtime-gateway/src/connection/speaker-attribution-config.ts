import type {
  RealtimeTokenClaims,
  SpeakerAttributionOptionsDto,
} from "@translation/contracts";
import type { RealtimeEnv } from "../config/env.js";
import { realtimeLogger } from "../metrics/realtime-metrics.js";
import type { RealtimeSession } from "../sessions/realtime-session.js";

const defaultSpeakerAttribution: SpeakerAttributionOptionsDto = {
  mode: "auto",
  maxSpeakers: 4,
  allowVoiceIdentity: false,
};

export function resolveSpeakerAttribution(claims: RealtimeTokenClaims) {
  return claims.speakerAttribution ?? defaultSpeakerAttribution;
}

export function logSpeakerAttributionConfigured(
  env: RealtimeEnv,
  session: RealtimeSession,
  speakerAttribution: SpeakerAttributionOptionsDto,
) {
  realtimeLogger.info({
    sessionId: session.id,
    speakerProvider: env.speakerProvider,
    speakerAttribution,
    usedServerDefault: session.claims.speakerAttribution === undefined,
  }, "Realtime speaker attribution configured");
}
