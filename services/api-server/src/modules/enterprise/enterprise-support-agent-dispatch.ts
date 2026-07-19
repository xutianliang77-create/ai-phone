import type { JobRuntimeProvider } from "@translation/contracts";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitDispatchProviderAdapter } from
  "../worker-dispatches/livekit-dispatch-provider-adapter.js";
import type { LiveKitDispatchConfig } from
  "../worker-dispatches/livekit-dispatch-readiness.js";
import type { EnterpriseSupportAgentDispatchResponse } from
  "@translation/contracts";

export interface EnterpriseSupportAgentDispatchService {
  ensure(input: EnterpriseSupportAgentDispatchResponse): Promise<
    { status: "ready" } | { status: "not_ready"; reasonCode: string }
  >;
}

export function createEnvironmentEnterpriseSupportAgentDispatchService():
  EnterpriseSupportAgentDispatchService {
  const configured = config();
  if (!configured.ok) return unavailable(configured.reasonCode);
  return createEnterpriseSupportAgentDispatchService(
    new LiveKitDispatchProviderAdapter(configured.config),
  );
}

export function createEnterpriseSupportAgentDispatchService(
  provider: JobRuntimeProvider,
): EnterpriseSupportAgentDispatchService {
  return {
    async ensure(input) {
      try {
        const listed = await provider.list(input.roomName);
        if (!listed.ok) return notReady(`dispatch_list_${listed.errorClass}`);
        if (listed.result.some((item) => item.agentName === input.agentName &&
          ticketId(item.metadata) === ticketId(input.ticket))) return { status: "ready" };
        const result = await provider.dispatch({
          operationId: `enterprise-support:${input.sessionId}:g${input.generation}`,
          sessionId: input.communicationSessionId,
          expectedVersion: 1,
          idempotencyKey: `enterprise-support:${input.sessionId}:g${input.generation}`,
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          payload: { roomName: input.roomName, agentName: input.agentName,
            metadata: input.ticket, restartPolicy: "never",
            ...(process.env.LIVEKIT_ENTERPRISE_SUPPORT_DEPLOYMENT?.trim()
              ? { deployment: process.env.LIVEKIT_ENTERPRISE_SUPPORT_DEPLOYMENT.trim() }
              : {}) },
        });
        return result.ok ? { status: "ready" } :
          notReady(`dispatch_${result.errorClass}`);
      } catch { return notReady("dispatch_unavailable"); }
    },
  };
}

function config(): { ok: true; config: LiveKitDispatchConfig } |
  { ok: false; reasonCode: string } {
  if (process.env.ENTERPRISE_SUPPORT_AGENT_RUNTIME_PROVIDER !== "livekit_dispatch") {
    return { ok: false, reasonCode: "livekit_dispatch_not_enabled" };
  }
  const room = getLiveKitRoomConfig();
  if (!room.ok) return { ok: false, reasonCode: "support_rtc_not_configured" };
  const secret = process.env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret) < 32) {
    return { ok: false, reasonCode: "worker_signing_not_configured" };
  }
  return { ok: true, config: { livekitUrl: room.config.livekitUrl,
    apiKey: room.config.apiKey, apiSecret: room.config.apiSecret,
    ticketSecret: secret,
    agentName: process.env.LIVEKIT_ENTERPRISE_SUPPORT_AGENT_NAME?.trim() ||
      "enterprise-support-agent",
    maxActiveJobs: integer("ENTERPRISE_SUPPORT_AGENT_MAX_ACTIVE_JOBS", 4),
    leaseSeconds: integer("ENTERPRISE_SUPPORT_AGENT_WORKER_LEASE_SECONDS", 45),
    heartbeatSeconds: integer("ENTERPRISE_SUPPORT_AGENT_HEARTBEAT_SECONDS", 15),
    readyTimeoutSeconds: integer("ENTERPRISE_SUPPORT_AGENT_READY_TIMEOUT_SECONDS", 20),
    requestTimeoutSeconds: integer("ENTERPRISE_SUPPORT_AGENT_REQUEST_TIMEOUT_SECONDS", 10),
    maxMetadataBytes: 4_096 } };
}
function ticketId(value: string) {
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || Buffer.byteLength(value) > 4_096) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as
      Record<string, unknown>;
    return typeof payload.ticketId === "string" ? payload.ticketId : null;
  } catch { return null; }
}
function unavailable(reasonCode: string): EnterpriseSupportAgentDispatchService {
  return { ensure: async () => notReady(reasonCode) };
}
function notReady(reasonCode: string) {
  return { status: "not_ready" as const, reasonCode };
}
function integer(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
