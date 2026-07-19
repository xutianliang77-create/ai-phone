import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingPstnProviderReadinessDto,
} from "@translation/contracts";
import type { EnterpriseMarketingPstnCallRequest } from
  "./enterprise-marketing-pstn.js";

export type EnterpriseMarketingPstnProviderResult =
  | { status: "accepted"; providerCallId?: string }
  | { status: "failed"; errorClass: string; retryable: boolean;
      reconciliationRequired: boolean };

export interface EnterpriseMarketingPstnProvider {
  readiness(): EnterpriseMarketingPstnProviderReadinessDto;
  dispatch(request: EnterpriseMarketingPstnCallRequest):
    Promise<EnterpriseMarketingPstnProviderResult>;
}

export function createEnvironmentEnterpriseMarketingPstnProvider(input: {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
} = {}): EnterpriseMarketingPstnProvider {
  const env = input.env ?? process.env;
  const provider = env.ENTERPRISE_MARKETING_PSTN_PROVIDER?.trim();
  const endpoint = bridgeEndpoint(env.ENTERPRISE_MARKETING_PSTN_BRIDGE_URL?.trim());
  const token = env.ENTERPRISE_MARKETING_PSTN_BRIDGE_TOKEN?.trim();
  if (provider !== "pstn_http" && provider !== "pstn_fonoster") {
    return unavailable("provider_not_configured");
  }
  if (!endpoint || !token || Buffer.byteLength(token) < 16) {
    return unavailable("provider_credentials_missing");
  }
  const webhookSecret = env.ENTERPRISE_MARKETING_PSTN_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return unavailable("provider_webhook_not_configured");
  if (Buffer.byteLength(webhookSecret) < 32) {
    return unavailable("provider_webhook_secret_invalid");
  }
  if (env.ENTERPRISE_MARKETING_PSTN_IDEMPOTENCY_GUARANTEED !== "true") {
    return unavailable("provider_idempotency_not_guaranteed");
  }
  return new HttpEnterpriseMarketingPstnProvider({ provider, endpoint, token,
    fetcher: input.fetcher ?? fetch, timeoutMs: timeout(env),
    fingerprint: createHash("sha256").update(`${provider}:${new URL(endpoint).origin}`)
      .digest("hex") });
}

class HttpEnterpriseMarketingPstnProvider
  implements EnterpriseMarketingPstnProvider {
  constructor(private readonly config: {
    provider: "pstn_http" | "pstn_fonoster";
    endpoint: string;
    token: string;
    fetcher: typeof fetch;
    timeoutMs: number;
    fingerprint: string;
  }) {}

  readiness(): EnterpriseMarketingPstnProviderReadinessDto {
    return { status: "ready", provider: this.config.provider,
      fingerprint: this.config.fingerprint };
  }

  async dispatch(request: EnterpriseMarketingPstnCallRequest):
    Promise<EnterpriseMarketingPstnProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.config.fetcher(this.config.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.token}`,
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey },
        body: JSON.stringify(request), signal: controller.signal,
      });
      const body = await json(response);
      if (response.ok && body && typeof body === "object") {
        const status = (body as Record<string, unknown>).status;
        if (status === "failed") {
          return { status: "failed", errorClass: "provider_rejected",
            retryable: false, reconciliationRequired: false };
        }
        if (status !== "in_progress" && status !== "completed") {
          return { status: "failed", errorClass: "invalid_response",
            retryable: true, reconciliationRequired: true };
        }
        const providerCallId = text((body as Record<string, unknown>).providerCallId, 160);
        return { status: "accepted", ...(providerCallId ? { providerCallId } : {}) };
      }
      return { status: "failed", errorClass: httpError(response.status),
        retryable: transient(response.status),
        reconciliationRequired: transient(response.status) };
    } catch (error) {
      return { status: "failed", errorClass: error instanceof Error &&
        error.name === "AbortError" ? "timeout" : "unavailable",
        retryable: true, reconciliationRequired: true };
    } finally { clearTimeout(timer); }
  }
}

function unavailable(reasonCode: string): EnterpriseMarketingPstnProvider {
  return { readiness: () => ({ status: reasonCode === "provider_not_configured"
    ? "not_configured" : "not_ready", provider: "unavailable", reasonCode }),
  dispatch: async () => ({ status: "failed", errorClass: reasonCode,
    retryable: false, reconciliationRequired: false }) };
}
function bridgeEndpoint(value: string | undefined) {
  if (!value) return null;
  try { const url = new URL(value); if (url.protocol !== "https:" || url.username ||
      url.password) return null; return new URL("agent-calls", url.toString().endsWith("/")
        ? url : `${url}/`).toString(); } catch { return null; }
}
function timeout(env: NodeJS.ProcessEnv) { const value = Number(
  env.ENTERPRISE_MARKETING_PSTN_TIMEOUT_MS ?? 10_000); return Number.isInteger(value) &&
    value >= 1_000 && value <= 10_000 ? value : 10_000; }
function transient(status: number) { return status === 408 || status === 425 ||
  status === 429 || status >= 500; }
function httpError(status: number) { if (status === 400) return "invalid_request";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "conflict"; if (status === 429) return "rate_limited";
  return status >= 500 ? "unavailable" : "provider_rejected"; }
async function json(response: Response) { try { return await response.json(); }
  catch { return null; } }
function text(value: unknown, max: number) { return typeof value === "string" &&
  value.trim() && value.length <= max ? value.trim() : ""; }
