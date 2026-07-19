import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { getLiveKitSipConfig } from "../call-links/livekit-sip-readiness.js";

export function getAgentConsultReadiness() {
  const enabled = process.env.VOICE_AGENT_OPERATOR_CONSULT_ENABLED === "true";
  const room = getLiveKitRoomConfig();
  const sip = getLiveKitSipConfig();
  const ttlSeconds = integer("VOICE_AGENT_OPERATOR_CONSULT_TTL_SECONDS", 180);
  const maxAttempts = integer("VOICE_AGENT_OPERATOR_CONSULT_MAX_ATTEMPTS", 3);
  const issues = enabled ? [
    ...(room.ok ? [] : room.issues),
    ...(sip.ok ? [] : sip.issues),
    ...(ttlSeconds >= 30 && ttlSeconds <= 600
      ? []
      : ["VOICE_AGENT_OPERATOR_CONSULT_TTL_SECONDS must be 30-600"]),
    ...(maxAttempts >= 1 && maxAttempts <= 5
      ? []
      : ["VOICE_AGENT_OPERATOR_CONSULT_MAX_ATTEMPTS must be 1-5"]),
  ] : ["External operator consultation is disabled"];
  return {
    status: enabled && issues.length === 0 ? "ready" as const : "not_ready" as const,
    enabled,
    ttlSeconds,
    maxAttempts,
    issues,
  };
}

export function getAgentConsultConfig() {
  const readiness = getAgentConsultReadiness();
  const room = getLiveKitRoomConfig();
  const sip = getLiveKitSipConfig();
  return readiness.status === "ready" && room.ok && sip.ok
    ? {
      ok: true as const,
      config: {
        room: room.config,
        sip: sip.config,
        ttlSeconds: readiness.ttlSeconds,
        maxAttempts: readiness.maxAttempts,
      },
    }
    : { ok: false as const, readiness };
}

function integer(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) ? value : fallback;
}
