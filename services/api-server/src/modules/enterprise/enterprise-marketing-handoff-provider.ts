import { createHash } from "node:crypto";
import type { EnterpriseMarketingHandoffStatusResponse } from "@translation/contracts";
import { enterpriseMarketingHandoffHash } from "./enterprise-marketing-handoff.js";

type Readiness = EnterpriseMarketingHandoffStatusResponse["provider"];
export type EnterpriseMarketingHandoffActivationResult =
  | { status: "completed"; providerFingerprint: string; receiptHash: string;
      aiAudioStoppedAt: string; operatorJoinedAt: string }
  | { status: "not_configured" | "not_ready" | "failed"; reasonCode: string };

export interface EnterpriseMarketingHandoffProvider {
  readiness(): Readiness;
  activate(input: { tenantId: string; handoffId: string; dispatchId: string;
    communicationSessionId: string; supportSessionId: string; claimId: string;
    agentUserId: string; requestedAt: string; idempotencyKey: string }):
    Promise<EnterpriseMarketingHandoffActivationResult>;
}

export function createEnvironmentEnterpriseMarketingHandoffProvider(input: {
  env?: NodeJS.ProcessEnv; fetcher?: typeof fetch;
} = {}): EnterpriseMarketingHandoffProvider {
  const env = input.env ?? process.env;
  const provider = env.ENTERPRISE_MARKETING_HANDOFF_PROVIDER?.trim();
  const endpoint = httpsEndpoint(env.ENTERPRISE_MARKETING_HANDOFF_BRIDGE_URL?.trim());
  const token = env.ENTERPRISE_MARKETING_HANDOFF_BRIDGE_TOKEN?.trim();
  if (provider !== "pstn_http" && provider !== "pstn_fonoster") {
    return unavailable("not_configured", "marketing_handoff_provider_not_configured");
  }
  if (!endpoint || !token || Buffer.byteLength(token) < 16) {
    return unavailable("not_ready", "marketing_handoff_provider_credentials_missing");
  }
  if (env.ENTERPRISE_MARKETING_HANDOFF_IDEMPOTENCY_GUARANTEED !== "true") {
    return unavailable("not_ready", "marketing_handoff_idempotency_not_guaranteed");
  }
  if (env.ENTERPRISE_MARKETING_HANDOFF_OPERATOR_JOIN_GUARANTEED !== "true") {
    return unavailable("not_ready", "marketing_handoff_operator_join_not_guaranteed");
  }
  if (env.ENTERPRISE_MARKETING_HANDOFF_AI_STOP_GUARANTEE_MS !== "300") {
    return unavailable("not_ready", "marketing_handoff_ai_stop_not_guaranteed");
  }
  const fingerprint = `${provider}:${createHash("sha256")
    .update(new URL(endpoint).origin).digest("hex").slice(0, 24)}:handoff-v1`;
  return new HttpProvider({ provider, endpoint, token, fingerprint,
    fetcher: input.fetcher ?? fetch });
}

class HttpProvider implements EnterpriseMarketingHandoffProvider {
  constructor(private readonly config: { provider: "pstn_http" | "pstn_fonoster";
    endpoint: string; token: string; fingerprint: string; fetcher: typeof fetch }) {}

  readiness(): Readiness {
    return { status: "ready", provider: this.config.provider,
      fingerprint: this.config.fingerprint, aiStopDeadlineMs: 300 };
  }

  async activate(input: Parameters<EnterpriseMarketingHandoffProvider["activate"]>[0]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    try {
      const response = await this.config.fetcher(this.config.endpoint, {
        method: "POST", signal: controller.signal,
        headers: { authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json", "idempotency-key": input.idempotencyKey },
        body: JSON.stringify({ ...input, aiStopDeadlineMs: 300 }),
      });
      const body = await json(response);
      if (!response.ok || !body) return failed(httpFailure(response.status));
      const stopLatencyMs = integer(body.stopLatencyMs, 0, 300);
      const aiAudioStoppedAt = timestamp(body.aiAudioStoppedAt);
      const operatorJoinedAt = timestamp(body.operatorJoinedAt);
      const receiptId = code(body.receiptId, 200);
      const requestedAt = Date.parse(input.requestedAt);
      const observedAt = Date.now();
      if (body.status !== "completed" || stopLatencyMs === null ||
        !Number.isFinite(requestedAt) ||
        !aiAudioStoppedAt || !operatorJoinedAt || !receiptId ||
        Date.parse(aiAudioStoppedAt) < requestedAt ||
        Date.parse(aiAudioStoppedAt) > requestedAt + 300 ||
        Date.parse(operatorJoinedAt) < Date.parse(aiAudioStoppedAt) ||
        Date.parse(operatorJoinedAt) > observedAt) {
        return failed("marketing_handoff_invalid_receipt");
      }
      return { status: "completed" as const,
        providerFingerprint: this.config.fingerprint,
        receiptHash: enterpriseMarketingHandoffHash({ receiptId, stopLatencyMs,
          aiAudioStoppedAt, operatorJoinedAt, handoffId: input.handoffId }),
        aiAudioStoppedAt, operatorJoinedAt };
    } catch (error) {
      return failed(error instanceof Error && error.name === "AbortError"
        ? "marketing_handoff_ai_stop_deadline_exceeded"
        : "marketing_handoff_provider_unavailable");
    } finally { clearTimeout(timer); }
  }
}

function unavailable(status: "not_configured" | "not_ready", reasonCode: string):
  EnterpriseMarketingHandoffProvider {
  return { readiness: () => ({ status, reasonCode, aiStopDeadlineMs: 300 }),
    activate: async () => ({ status, reasonCode }) };
}
function failed(reasonCode: string) {
  return { status: "failed" as const, reasonCode };
}
function httpsEndpoint(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username &&
    !url.password ? new URL("marketing-handoffs/activate", url.toString().endsWith("/")
      ? url : `${url}/`).toString() : null; } catch { return null; }
}
async function json(response: Response): Promise<Record<string, unknown> | null> {
  try { const value = await response.json(); return value && typeof value === "object" &&
    !Array.isArray(value) ? value as Record<string, unknown> : null; } catch { return null; }
}
function timestamp(value: unknown) { if (typeof value !== "string") return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) &&
    date.toISOString() === value ? value : null; }
function integer(value: unknown, min: number, max: number) { return typeof value === "number" &&
  Number.isSafeInteger(value) && value >= min && value <= max ? value : null; }
function code(value: unknown, max: number) { return typeof value === "string" &&
  Buffer.byteLength(value) <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ? value : null; }
function httpFailure(status: number) { return status === 401 || status === 403
  ? "marketing_handoff_provider_unauthorized" : status === 409
    ? "marketing_handoff_provider_conflict" : "marketing_handoff_provider_failed"; }
