import type { JobRuntimeProvider } from "@translation/contracts";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitDispatchProviderAdapter } from
  "../worker-dispatches/livekit-dispatch-provider-adapter.js";
import type { LiveKitDispatchConfig } from
  "../worker-dispatches/livekit-dispatch-readiness.js";
import type { EnterpriseMeetingScreenOcrDispatch } from
  "./enterprise-meeting-screen-ocr.js";

export interface EnterpriseMeetingScreenOcrDispatchService {
  ensure(input: EnterpriseMeetingScreenOcrDispatch): Promise<
    | { status: "ready" }
    | { status: "not_configured" | "failed"; reasonCode: string }
  >;
}

export function createEnvironmentEnterpriseMeetingScreenOcrDispatchService():
  EnterpriseMeetingScreenOcrDispatchService {
  const configured = config();
  if (!configured.ok) return unavailable(
    configured.status, configured.reasonCode,
  );
  return createEnterpriseMeetingScreenOcrDispatchService(
    new LiveKitDispatchProviderAdapter(configured.config),
  );
}

export function createEnterpriseMeetingScreenOcrDispatchService(
  provider: JobRuntimeProvider,
): EnterpriseMeetingScreenOcrDispatchService {
  return {
    async ensure(input) {
      try {
        const listed = await provider.list(input.roomName);
        if (!listed.ok) return failed(`screen_ocr_dispatch_${listed.errorClass}`);
        if (listed.result.some((item) => item.agentName === input.agentName &&
          ticketRunId(item.metadata) === input.run.id)) return { status: "ready" };
        const result = await provider.dispatch({
          operationId: `screen-ocr:${input.run.id}`,
          sessionId: input.communicationSessionId,
          expectedVersion: input.run.version,
          idempotencyKey: `screen-ocr:${input.run.id}`,
          deadlineAt: new Date(Date.now() + 10_000).toISOString(),
          payload: {
            roomName: input.roomName, agentName: input.agentName,
            metadata: input.ticket, restartPolicy: "never",
            ...(process.env.LIVEKIT_ENTERPRISE_SCREEN_OCR_DEPLOYMENT?.trim()
              ? { deployment:
                process.env.LIVEKIT_ENTERPRISE_SCREEN_OCR_DEPLOYMENT.trim() }
              : {}),
          },
        });
        return result.ok ? { status: "ready" }
          : failed(`screen_ocr_dispatch_${result.errorClass}`);
      } catch {
        return failed("screen_ocr_dispatch_unavailable");
      }
    },
  };
}

function config(): { ok: true; config: LiveKitDispatchConfig } |
  { ok: false; status: "not_configured" | "failed"; reasonCode: string } {
  if (process.env.ENTERPRISE_SCREEN_OCR_ENABLED !== "true" ||
    process.env.ENTERPRISE_SCREEN_OCR_PROVIDER !== "http") {
    return { ok: false, status: "not_configured",
      reasonCode: "screen_ocr_provider_not_configured" };
  }
  const endpoint = httpsUrl(process.env.ENTERPRISE_SCREEN_OCR_ENDPOINT);
  const apiKey = process.env.ENTERPRISE_SCREEN_OCR_API_KEY?.trim();
  if (!endpoint || !apiKey) return { ok: false, status: "failed",
    reasonCode: "screen_ocr_provider_configuration_invalid" };
  if (process.env.TRANSLATION_WORKER_RUNTIME_PROVIDER !== "livekit_dispatch") {
    return { ok: false, status: "failed",
      reasonCode: "screen_ocr_dispatch_not_enabled" };
  }
  const room = getLiveKitRoomConfig();
  if (!room.ok) return { ok: false, status: "failed",
    reasonCode: "meeting_rtc_not_configured" };
  const secret = process.env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? "";
  if (Buffer.byteLength(secret) < 32) return { ok: false, status: "failed",
    reasonCode: "screen_ocr_signing_not_configured" };
  const agentName = process.env.LIVEKIT_ENTERPRISE_TRANSLATION_AGENT_NAME?.trim() ||
    process.env.LIVEKIT_TRANSLATION_AGENT_NAME?.trim() ||
    "translation-runtime";
  return { ok: true, config: {
    livekitUrl: room.config.livekitUrl, apiKey: room.config.apiKey,
    apiSecret: room.config.apiSecret, ticketSecret: secret, agentName,
    maxActiveJobs: integer("LIVEKIT_DISPATCH_MAX_ACTIVE_JOBS", 4),
    leaseSeconds: 45, heartbeatSeconds: 15, readyTimeoutSeconds: 20,
    requestTimeoutSeconds: integer("LIVEKIT_DISPATCH_REQUEST_TIMEOUT_SECONDS", 10),
    maxMetadataBytes: 4_096,
  } };
}

function unavailable(status: "not_configured" | "failed", reasonCode: string) {
  return { ensure: async () => ({ status, reasonCode }) };
}
function failed(reasonCode: string) {
  return { status: "failed" as const, reasonCode };
}
function ticketRunId(value: string) {
  if (Buffer.byteLength(value) > 4_096) return null;
  try {
    const encoded = value.split(".")[0];
    if (!encoded) return null;
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return typeof payload.runId === "string" ? payload.runId : null;
  } catch { return null; }
}
function httpsUrl(value: string | undefined) {
  try {
    const url = new URL(value?.trim() ?? "");
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}
function integer(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
