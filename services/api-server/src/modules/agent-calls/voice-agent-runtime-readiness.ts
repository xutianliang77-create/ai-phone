import type { LiveKitDispatchConfig } from "../worker-dispatches/livekit-dispatch-readiness.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";

export function voiceAgentRuntimeProvider() {
  return process.env.VOICE_AGENT_RUNTIME_PROVIDER === "livekit_dispatch"
    ? "livekit_dispatch" as const
    : "disabled" as const;
}

export function getVoiceAgentRuntimeReadiness() {
  const enabled = process.env.VOICE_AGENT_ENABLED === "true" &&
    process.env.VOICE_AGENT_AUTONOMOUS_ENABLED === "true";
  if (!enabled) {
    return {
      enabled: false,
      status: "disabled" as const,
      provider: voiceAgentRuntimeProvider(),
      agentName: agentName(),
      issues: ["Autonomous Voice Agent runtime is disabled"],
    };
  }
  const room = getLiveKitRoomConfig();
  const issues = [
    ...(voiceAgentRuntimeProvider() === "livekit_dispatch"
      ? []
      : ["VOICE_AGENT_RUNTIME_PROVIDER must be livekit_dispatch"]),
    ...(room.ok ? [] : room.issues),
    ...secretIssue("VOICE_AGENT_DISPATCH_TICKET_SECRET", 32),
    ...secretIssue("INTERNAL_API_SECRET", 16),
    ...requiredIssue("VOICE_AGENT_STT_MODEL"),
    ...requiredIssue("VOICE_AGENT_LLM_MODEL"),
    ...requiredIssue("VOICE_AGENT_TTS_MODEL"),
    ...requiredIssue("VOICE_AGENT_TTS_VOICE"),
    ...requiredIssue("VOICE_AGENT_DISCLOSURE_TEXT_ZH"),
    ...requiredIssue("VOICE_AGENT_DISCLOSURE_TEXT_EN"),
    ...nameIssue(),
    ...integerIssue("VOICE_AGENT_MAX_JOBS_PER_NODE", 1, 32),
    ...integerIssue("VOICE_AGENT_DISPATCH_MAX_ACTIVE_JOBS", 1, 100),
    ...integerIssue("VOICE_AGENT_DISPATCH_LEASE_SECONDS", 15, 300),
    ...integerIssue("VOICE_AGENT_DISPATCH_HEARTBEAT_SECONDS", 5, 60),
    ...integerIssue("VOICE_AGENT_DISPATCH_READY_TIMEOUT_SECONDS", 5, 120),
    ...integerIssue("VOICE_AGENT_DISPATCH_REQUEST_TIMEOUT_SECONDS", 2, 30),
  ];
  return {
    enabled: true,
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    provider: voiceAgentRuntimeProvider(),
    agentName: agentName(),
    issues,
  };
}

export function getVoiceAgentDispatchConfig():
  | { ok: true; config: LiveKitDispatchConfig }
  | { ok: false; issues: string[] } {
  const readiness = getVoiceAgentRuntimeReadiness();
  const room = getLiveKitRoomConfig();
  if (readiness.status !== "ready" || !room.ok) {
    return { ok: false, issues: readiness.issues };
  }
  return {
    ok: true,
    config: {
      livekitUrl: room.config.livekitUrl,
      apiKey: room.config.apiKey,
      apiSecret: room.config.apiSecret,
      ticketSecret: process.env.VOICE_AGENT_DISPATCH_TICKET_SECRET!,
      agentName: agentName(),
      ...(process.env.VOICE_AGENT_DISPATCH_DEPLOYMENT?.trim()
        ? { deployment: process.env.VOICE_AGENT_DISPATCH_DEPLOYMENT.trim() }
        : {}),
      maxActiveJobs: integer("VOICE_AGENT_DISPATCH_MAX_ACTIVE_JOBS", 2),
      leaseSeconds: integer("VOICE_AGENT_DISPATCH_LEASE_SECONDS", 45),
      heartbeatSeconds: integer("VOICE_AGENT_DISPATCH_HEARTBEAT_SECONDS", 15),
      readyTimeoutSeconds: integer("VOICE_AGENT_DISPATCH_READY_TIMEOUT_SECONDS", 25),
      requestTimeoutSeconds: integer("VOICE_AGENT_DISPATCH_REQUEST_TIMEOUT_SECONDS", 10),
      maxMetadataBytes: 2048,
    },
  };
}

function agentName() {
  return process.env.LIVEKIT_VOICE_AGENT_NAME?.trim() || "voice-agent-runtime";
}

function requiredIssue(name: string) {
  return process.env[name]?.trim() ? [] : [`${name} is required`];
}

function secretIssue(name: string, minimum: number) {
  return Buffer.byteLength(process.env[name] ?? "") >= minimum
    ? []
    : [`${name} must be at least ${minimum} bytes`];
}

function nameIssue() {
  return /^[a-z0-9][a-z0-9_-]{2,63}$/.test(agentName())
    ? []
    : ["LIVEKIT_VOICE_AGENT_NAME is invalid"];
}

function integerIssue(name: string, minimum: number, maximum: number) {
  const value = process.env[name];
  if (!value) return [];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? []
    : [`${name} must be ${minimum}-${maximum}`];
}

function integer(name: string, fallback: number) {
  return process.env[name] ? Number(process.env[name]) : fallback;
}
