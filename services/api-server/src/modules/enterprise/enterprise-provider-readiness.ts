import type {
  EnterpriseProviderCapability,
  EnterpriseProviderCapabilityDocument,
  EnterpriseProviderCapabilityStatus,
} from "@translation/contracts";

type Environment = Record<string, string | undefined>;

interface ProviderSpec {
  capability: EnterpriseProviderCapability;
  providerKey: string;
  healthUrlKey: string;
  apiKey: string;
  features: readonly string[];
  pstn?: true;
}

export interface EnterpriseProviderReadinessService {
  getCapabilities(input: { region: string }): Promise<EnterpriseProviderCapabilityDocument[]>;
}

const specs: ProviderSpec[] = [
  {
    capability: "pstn.outbound",
    providerKey: "PSTN_PROVIDER",
    healthUrlKey: "PSTN_BRIDGE_BASE_URL",
    apiKey: "PSTN_BRIDGE_API_KEY",
    features: ["outbound", "inbound", "clearPlayback"],
    pstn: true,
  },
  {
    capability: "crm.sync",
    providerKey: "ENTERPRISE_CRM_PROVIDER",
    healthUrlKey: "ENTERPRISE_CRM_HEALTH_URL",
    apiKey: "ENTERPRISE_CRM_API_KEY",
    features: ["read", "write", "webhook"],
  },
  {
    capability: "calendar.meetings",
    providerKey: "ENTERPRISE_CALENDAR_PROVIDER",
    healthUrlKey: "ENTERPRISE_CALENDAR_HEALTH_URL",
    apiKey: "ENTERPRISE_CALENDAR_API_KEY",
    features: ["read", "create", "webhook"],
  },
  {
    capability: "channel.messaging",
    providerKey: "ENTERPRISE_CHANNEL_PROVIDER",
    healthUrlKey: "ENTERPRISE_CHANNEL_HEALTH_URL",
    apiKey: "ENTERPRISE_CHANNEL_API_KEY",
    features: ["inbound", "outbound", "attachments"],
  },
  {
    capability: "screen.ocr",
    providerKey: "ENTERPRISE_SCREEN_OCR_PROVIDER",
    healthUrlKey: "ENTERPRISE_SCREEN_OCR_HEALTH_URL",
    apiKey: "ENTERPRISE_SCREEN_OCR_API_KEY",
    features: ["ocr", "translation", "layout"],
  },
];

export function createEnterpriseProviderReadinessService(options: {
  env?: Environment;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
} = {}): EnterpriseProviderReadinessService {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 2_500;

  return {
    async getCapabilities(input) {
      return Promise.all(specs.map((spec) => checkCapability({
        spec,
        region: input.region,
        env,
        fetcher,
        now,
        timeoutMs,
      })));
    },
  };
}

async function checkCapability(input: {
  spec: ProviderSpec;
  region: string;
  env: Environment;
  fetcher: typeof fetch;
  now: () => number;
  timeoutMs: number;
}) {
  const { spec, env } = input;
  const provider = cleanProvider(env[spec.providerKey]);
  const timestamps = capabilityTimestamps(input.now);
  const base = {
    provider: provider || "not_configured",
    capability: spec.capability,
    region: input.region,
    ...timestamps,
    features: emptyFeatures(spec.features),
    fingerprint: provider ? "unverified" : "unconfigured",
  };
  if (spec.pstn && !pstnEnabled(env.CALL_PROVIDER_POLICY)) {
    return { ...base, status: "not_configured", reasonCode: "provider_disabled" } as const;
  }
  if (!provider) {
    return { ...base, status: "not_configured", reasonCode: "provider_not_configured" } as const;
  }
  if (provider === "mock") {
    return { ...base, status: "not_ready", reasonCode: "mock_not_release_ready" } as const;
  }
  if (provider === "invalid") {
    return { ...base, status: "not_ready", reasonCode: "invalid_configuration" } as const;
  }
  const healthUrl = healthUrlFor(spec, env[spec.healthUrlKey]);
  const apiKey = env[spec.apiKey]?.trim();
  if (!healthUrl || !apiKey) {
    return { ...base, status: "not_ready", reasonCode: "configuration_missing" } as const;
  }
  return probeCapability({ ...input, healthUrl, apiKey, base });
}

async function probeCapability(input: {
  spec: ProviderSpec;
  fetcher: typeof fetch;
  timeoutMs: number;
  healthUrl: string;
  apiKey: string;
  base: Omit<EnterpriseProviderCapabilityDocument, "status">;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetcher(input.healthUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) return failureDocument(input.base, "probe_failed");
    const payload = await readProbe(response);
    if (!payload) return failureDocument(input.base, "invalid_probe_response");
    return {
      ...input.base,
      status: payload.status,
      ...(payload.status === "degraded" ? { reasonCode: "provider_degraded" } : {}),
      ...(payload.status === "not_ready" ? { reasonCode: "provider_not_ready" } : {}),
      ...(payload.status === "checking" ? { reasonCode: "provider_checking" } : {}),
      features: safeFeatures(input.spec.features, payload.features),
      fingerprint: safeFingerprint(payload.fingerprint),
    };
  } catch {
    return failureDocument(input.base, "probe_unreachable");
  } finally {
    clearTimeout(timeout);
  }
}

async function readProbe(response: Response) {
  try {
    const value = await response.json() as unknown;
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    return isProbeStatus(record.status)
      ? {
          status: record.status,
          features: record.features,
          fingerprint: record.fingerprint,
        }
      : null;
  } catch {
    return null;
  }
}

function failureDocument(
  base: Omit<EnterpriseProviderCapabilityDocument, "status">,
  reasonCode: string,
) {
  return { ...base, status: "not_ready" as const, reasonCode };
}

function capabilityTimestamps(now: () => number) {
  const checkedAt = now();
  return {
    checkedAt: new Date(checkedAt).toISOString(),
    expiresAt: new Date(checkedAt + 60_000).toISOString(),
  };
}

function healthUrlFor(spec: ProviderSpec, value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (spec.pstn) url.pathname = `${url.pathname.replace(/\/$/, "")}/health/release-ready`;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanProvider(value: string | undefined) {
  const provider = value?.trim().toLowerCase() ?? "";
  if (!provider || ["off", "none", "not_configured"].includes(provider)) return "";
  return /^[a-z][a-z0-9_-]{1,63}$/.test(provider) ? provider : "invalid";
}

function pstnEnabled(policy: string | undefined) {
  return policy === "pstn_enabled" || policy === "domestic_pstn_bridge";
}

function emptyFeatures(keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, false]));
}

function safeFeatures(keys: readonly string[], value: unknown) {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(keys.map((key) => [key, source[key] === true]));
}

function safeFingerprint(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,80}$/.test(value)
    ? value
    : "unverified";
}

function isProbeStatus(value: unknown): value is Exclude<
  EnterpriseProviderCapabilityStatus,
  "not_configured"
> {
  return value === "checking" || value === "ready" ||
    value === "degraded" || value === "not_ready";
}
