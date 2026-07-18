import type { JobRuntimeProvider } from "@translation/contracts";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitDispatchProviderAdapter } from
  "../worker-dispatches/livekit-dispatch-provider-adapter.js";
import type { LiveKitDispatchConfig } from
  "../worker-dispatches/livekit-dispatch-readiness.js";
import type { EnterpriseMeetingTranslationDispatch } from
  "./enterprise-meeting-runtime.js";

export interface EnterpriseMeetingTranslationDispatchService {
  ensure(input: EnterpriseMeetingTranslationDispatch): Promise<
    | { status: "ready" }
    | { status: "not_ready"; reasonCode: string }
  >;
}

export function createEnvironmentEnterpriseMeetingTranslationDispatchService():
  EnterpriseMeetingTranslationDispatchService {
  const configured = config();
  if (!configured.ok) return unavailable(configured.reasonCode);
  return createEnterpriseMeetingTranslationDispatchService(
    new LiveKitDispatchProviderAdapter(configured.config),
  );
}

export function createEnterpriseMeetingTranslationDispatchService(
  provider: JobRuntimeProvider,
): EnterpriseMeetingTranslationDispatchService {
  return {
    async ensure(input) {
      try {
        const listed = await provider.list(input.roomName);
        if (!listed.ok) return notReady(`dispatch_list_${listed.errorClass}`);
        const expected = ticketBinding(input.ticket);
        if (expected && listed.result.some((item) => {
          const existing = ticketBinding(item.metadata);
          return item.agentName === input.agentName && existing &&
            existing.ticketId === expected.ticketId &&
            existing.communicationSessionId === expected.communicationSessionId &&
            existing.generation === expected.generation;
        })) return { status: "ready" };
        const result = await provider.dispatch({
          operationId: `enterprise-meeting:${input.meetingId}:g${input.generation}`,
          sessionId: input.communicationSessionId,
          expectedVersion: 1,
          idempotencyKey: `enterprise-meeting:${input.meetingId}:g${input.generation}`,
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          payload: {
            roomName: input.roomName,
            agentName: input.agentName,
            metadata: input.ticket,
            restartPolicy: "never",
            ...(process.env.LIVEKIT_ENTERPRISE_TRANSLATION_DEPLOYMENT?.trim()
              ? { deployment:
                process.env.LIVEKIT_ENTERPRISE_TRANSLATION_DEPLOYMENT.trim() }
              : {}),
          },
        });
        return result.ok
          ? { status: "ready" }
          : notReady(`dispatch_${result.errorClass}`);
      } catch {
        return notReady("dispatch_unavailable");
      }
    },
  };
}

function config():
  | { ok: true; config: LiveKitDispatchConfig }
  | { ok: false; reasonCode: string } {
  if (process.env.TRANSLATION_WORKER_RUNTIME_PROVIDER !== "livekit_dispatch") {
    return { ok: false, reasonCode: "livekit_dispatch_not_enabled" };
  }
  const room = getLiveKitRoomConfig();
  if (!room.ok) return { ok: false, reasonCode: "meeting_rtc_not_configured" };
  const secret = process.env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret) < 32) {
    return { ok: false, reasonCode: "worker_signing_not_configured" };
  }
  return {
    ok: true,
    config: {
      livekitUrl: room.config.livekitUrl,
      apiKey: room.config.apiKey,
      apiSecret: room.config.apiSecret,
      ticketSecret: secret,
      agentName: process.env.LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME?.trim() ||
        "enterprise-translation-runtime",
      maxActiveJobs: integer("LIVEKIT_DISPATCH_MAX_ACTIVE_JOBS", 4),
      leaseSeconds: integer("ENTERPRISE_MEETING_WORKER_LEASE_SECONDS", 45),
      heartbeatSeconds: integer("LIVEKIT_DISPATCH_HEARTBEAT_SECONDS", 15),
      readyTimeoutSeconds: integer("LIVEKIT_DISPATCH_READY_TIMEOUT_SECONDS", 20),
      requestTimeoutSeconds: integer("LIVEKIT_DISPATCH_REQUEST_TIMEOUT_SECONDS", 10),
      maxMetadataBytes: integer("LIVEKIT_DISPATCH_MAX_METADATA_BYTES", 4096),
    },
  };
}

function unavailable(reasonCode: string): EnterpriseMeetingTranslationDispatchService {
  return { ensure: async () => notReady(reasonCode) };
}
function notReady(reasonCode: string) {
  return { status: "not_ready" as const, reasonCode };
}
function integer(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function ticketBinding(value: string) {
  if (Buffer.byteLength(value) > 4_096) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return payload.v === 3 && uuid(payload.ticketId) &&
        uuid(payload.communicationSessionId) && positive(payload.generation)
      ? { ticketId: payload.ticketId,
          communicationSessionId: payload.communicationSessionId,
          generation: payload.generation }
      : null;
  } catch {
    return null;
  }
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
