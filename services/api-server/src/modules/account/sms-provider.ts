export interface SmsDelivery {
  provider: string;
  messageId?: string;
}

export interface SmsReadiness {
  status: "ready" | "not_ready";
  provider: string;
  endpoint: "configured" | "configuration_required";
  apiKey: "configured" | "configuration_required";
  templateId: "configured" | "configuration_required";
  signName: "configured" | "configuration_required";
  timeoutMs: number;
  issues: string[];
}

export async function sendPhoneLoginCode(input: {
  phone: string;
  phoneMasked: string;
  code: string;
  expiresInSeconds: number;
}): Promise<{ ok: true; delivery: SmsDelivery } | { ok: false; code: string }> {
  const provider = smsProvider();
  if (provider === "debug") {
    return { ok: true, delivery: { provider: "debug" } };
  }
  if (provider !== "http")
    return { ok: false, code: "sms_provider_unconfigured" };
  const readiness = httpSmsRuntimeReadiness();
  if (readiness.issues.length > 0) {
    return { ok: false, code: "sms_provider_unconfigured" };
  }
  return sendHttpSms(input);
}

export function shouldExposeDebugCode() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.AUTH_DEBUG_OTP === "true"
  );
}

export function getSmsDeploymentReadiness(): SmsReadiness {
  const provider = (process.env.SMS_PROVIDER ?? "").trim() || "not_configured";
  const timeoutMs = smsTimeoutMs();
  const issues = [
    ...providerIssues(provider),
    ...httpSmsReadinessIssues(provider),
    ...timeoutIssues(),
  ];
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    provider,
    endpoint: configured("SMS_HTTP_ENDPOINT"),
    apiKey: configured("SMS_HTTP_API_KEY"),
    templateId: configured("SMS_HTTP_TEMPLATE_ID"),
    signName: configured("SMS_SIGN_NAME"),
    timeoutMs,
    issues,
  };
}

function smsProvider() {
  const provider = (process.env.SMS_PROVIDER ?? "").trim();
  if (provider) return provider;
  if (process.env.SMS_HTTP_ENDPOINT) return "http";
  return "debug";
}

async function sendHttpSms(input: {
  phone: string;
  phoneMasked: string;
  code: string;
  expiresInSeconds: number;
}) {
  const endpoint = process.env.SMS_HTTP_ENDPOINT ?? "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), smsTimeoutMs());
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.SMS_HTTP_API_KEY}`,
      },
      body: JSON.stringify({
        scene: "phone_login",
        phone: input.phone,
        phoneMasked: input.phoneMasked,
        templateId: process.env.SMS_HTTP_TEMPLATE_ID,
        signName: process.env.SMS_SIGN_NAME,
        templateParams: {
          code: input.code,
          expiresInMinutes: Math.ceil(input.expiresInSeconds / 60),
        },
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      return { ok: false as const, code: "sms_delivery_failed" };
    const body = await readJson(response);
    return {
      ok: true as const,
      delivery: {
        provider: "http",
        messageId: parseMessageId(body),
      },
    };
  } catch {
    return { ok: false as const, code: "sms_delivery_failed" };
  } finally {
    clearTimeout(timer);
  }
}

function httpSmsRuntimeReadiness() {
  return {
    issues: [
      ...missingIssues([
        "SMS_HTTP_ENDPOINT",
        "SMS_HTTP_API_KEY",
        "SMS_HTTP_TEMPLATE_ID",
        "SMS_SIGN_NAME",
      ]),
      ...endpointIssues("SMS_HTTP_ENDPOINT", false),
      ...secretIssues("SMS_HTTP_API_KEY"),
      ...timeoutIssues(),
    ],
  };
}

function providerIssues(provider: string) {
  if (provider === "http") return [];
  if (provider === "debug") return ["sms provider debug is not release-ready"];
  if (provider === "not_configured") return ["sms missing SMS_PROVIDER"];
  return [`sms invalid SMS_PROVIDER ${provider}`];
}

function httpSmsReadinessIssues(provider: string) {
  if (provider !== "http") return [];
  return [
    ...missingIssues([
      "SMS_HTTP_ENDPOINT",
      "SMS_HTTP_API_KEY",
      "SMS_HTTP_TEMPLATE_ID",
      "SMS_SIGN_NAME",
    ]),
    ...endpointIssues("SMS_HTTP_ENDPOINT", true),
    ...secretIssues("SMS_HTTP_API_KEY"),
  ];
}

function missingIssues(keys: string[]) {
  return keys
    .filter((key) => !process.env[key])
    .map((key) => `sms missing ${key}`);
}

function endpointIssues(key: string, requireHttps: boolean) {
  const value = process.env[key];
  if (!value) return [];
  try {
    const parsed = new URL(value);
    const issues: string[] = [];
    if (requireHttps && parsed.protocol !== "https:") {
      issues.push(`sms invalid ${key}:https_required`);
    }
    if (isLocalHost(parsed.hostname)) {
      issues.push(`sms invalid ${key}:public_host_required`);
    }
    return issues;
  } catch {
    return [`sms invalid ${key}`];
  }
}

function secretIssues(key: string) {
  const secret = process.env[key];
  return secret && secret.length < 24 ? [`sms invalid ${key}`] : [];
}

function timeoutIssues() {
  const value = process.env.SMS_HTTP_TIMEOUT_MS;
  if (!value) return [];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 30000
    ? []
    : ["sms invalid SMS_HTTP_TIMEOUT_MS"];
}

function smsTimeoutMs() {
  const parsed = Number(process.env.SMS_HTTP_TIMEOUT_MS);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 30000
    ? parsed
    : 5000;
}

function configured(key: string) {
  return process.env[key] ? "configured" : "configuration_required";
}

function isLocalHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1"
  );
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseMessageId(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return undefined;
  const value = (body as Record<string, unknown>).messageId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
