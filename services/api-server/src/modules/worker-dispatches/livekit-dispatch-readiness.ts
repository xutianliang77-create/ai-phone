import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";

export interface LiveKitDispatchConfig {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  ticketSecret: string;
  agentName: string;
  deployment?: string;
  maxActiveJobs: number;
  leaseSeconds: number;
  heartbeatSeconds: number;
  readyTimeoutSeconds: number;
  requestTimeoutSeconds: number;
  maxMetadataBytes: number;
}

export function workerRuntimeProvider() {
  return process.env.TRANSLATION_WORKER_RUNTIME_PROVIDER === "livekit_dispatch"
    ? "livekit_dispatch" as const
    : "local_process" as const;
}

export function getLiveKitDispatchReadiness() {
  const room = getLiveKitRoomConfig();
  const issues = [
    ...(workerRuntimeProvider() === "livekit_dispatch"
      ? []
      : ["dispatch requires TRANSLATION_WORKER_RUNTIME_PROVIDER=livekit_dispatch"]),
    ...(room.ok ? [] : room.issues),
    ...secretIssues(),
    ...agentNameIssues(),
    ...integerIssues("LIVEKIT_DISPATCH_MAX_ACTIVE_JOBS", 1, 100),
    ...integerIssues("LIVEKIT_DISPATCH_LEASE_SECONDS", 15, 300),
    ...integerIssues("LIVEKIT_DISPATCH_HEARTBEAT_SECONDS", 5, 60),
    ...integerIssues("LIVEKIT_DISPATCH_READY_TIMEOUT_SECONDS", 5, 120),
    ...integerIssues("LIVEKIT_DISPATCH_REQUEST_TIMEOUT_SECONDS", 2, 30),
    ...integerIssues("LIVEKIT_DISPATCH_MAX_METADATA_BYTES", 256, 4096),
  ];
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    provider: workerRuntimeProvider(),
    agentName: agentName(),
    issues,
  };
}

export function getLiveKitDispatchConfig():
  | { ok: true; config: LiveKitDispatchConfig }
  | { ok: false; issues: string[] } {
  const readiness = getLiveKitDispatchReadiness();
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
      ticketSecret: process.env.LIVEKIT_DISPATCH_TICKET_SECRET!,
      agentName: agentName(),
      ...(process.env.LIVEKIT_DISPATCH_DEPLOYMENT?.trim()
        ? { deployment: process.env.LIVEKIT_DISPATCH_DEPLOYMENT.trim() }
        : {}),
      maxActiveJobs: integer("LIVEKIT_DISPATCH_MAX_ACTIVE_JOBS", 4),
      leaseSeconds: integer("LIVEKIT_DISPATCH_LEASE_SECONDS", 45),
      heartbeatSeconds: integer("LIVEKIT_DISPATCH_HEARTBEAT_SECONDS", 15),
      readyTimeoutSeconds: integer("LIVEKIT_DISPATCH_READY_TIMEOUT_SECONDS", 20),
      requestTimeoutSeconds: integer("LIVEKIT_DISPATCH_REQUEST_TIMEOUT_SECONDS", 10),
      maxMetadataBytes: integer("LIVEKIT_DISPATCH_MAX_METADATA_BYTES", 2048),
    },
  };
}

function agentName() {
  return process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() || "translation-runtime";
}

function secretIssues() {
  const value = process.env.LIVEKIT_DISPATCH_TICKET_SECRET ?? "";
  return Buffer.byteLength(value) >= 32
    ? []
    : ["dispatch LIVEKIT_DISPATCH_TICKET_SECRET must be at least 32 bytes"];
}

function agentNameIssues() {
  return /^[a-z0-9][a-z0-9_-]{2,63}$/.test(agentName())
    ? []
    : ["dispatch LIVEKIT_TRANSLATION_AGENT_NAME is invalid"];
}

function integerIssues(name: string, minimum: number, maximum: number) {
  const value = process.env[name];
  if (!value) return [];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? []
    : [`dispatch ${name} must be ${minimum}-${maximum}`];
}

function integer(name: string, fallback: number) {
  return process.env[name] ? Number(process.env[name]) : fallback;
}
