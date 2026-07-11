import { loadEnv } from "../../config/env.js";

type PstnProvider = "twilio" | "telnyx" | "domestic_bridge";

export interface PstnReadiness {
  status: "ready" | "not_ready";
  policy: string;
  enabled: boolean;
  provider: string;
  account: "configured" | "configuration_required";
  apiKey: "configured" | "configuration_required";
  webhookBaseUrl: "configured" | "configuration_required";
  webhookSecret: "configured" | "configuration_required";
  consentPromptVersion: "configured" | "configuration_required";
  recordingDisclosure: "enabled" | "configuration_required";
  maxCallMinutes: number | null;
  issues: string[];
}

export function getPstnReadiness(): PstnReadiness {
  const policy = loadEnv().callProviderPolicy;
  const enabled = isPstnEnabled(policy);
  const provider = (process.env.PSTN_PROVIDER ?? "").trim();
  const issues = enabled ? enabledIssues(policy, provider) : disabledIssues(policy);
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    policy,
    enabled,
    provider: provider || "not_configured",
    account: configured("PSTN_ACCOUNT_ID"),
    apiKey: configured("PSTN_API_KEY"),
    webhookBaseUrl: configured("PSTN_WEBHOOK_BASE_URL"),
    webhookSecret: configured("PSTN_WEBHOOK_SECRET"),
    consentPromptVersion: configured("PSTN_CONSENT_PROMPT_VERSION"),
    recordingDisclosure: process.env.PSTN_RECORDING_DISCLOSURE_ENABLED === "true"
      ? "enabled"
      : "configuration_required",
    maxCallMinutes: maxCallMinutes(),
    issues,
  };
}

function enabledIssues(policy: string, provider: string) {
  return [
    ...disabledIssues(policy),
    ...providerIssues(provider),
    ...missingIssues([
      "PSTN_ACCOUNT_ID",
      "PSTN_API_KEY",
      "PSTN_WEBHOOK_BASE_URL",
      "PSTN_WEBHOOK_SECRET",
      "PSTN_CONSENT_PROMPT_VERSION",
      "PSTN_MAX_CALL_MINUTES",
    ]),
    ...webhookBaseUrlIssues(),
    ...secretIssues(),
    ...recordingDisclosureIssues(),
    ...maxCallMinutesIssues(),
  ];
}

function disabledIssues(policy: string) {
  if (policy === "call_link_only" || isPstnEnabled(policy)) return [];
  return [`pstn invalid CALL_PROVIDER_POLICY ${policy}`];
}

function providerIssues(provider: string) {
  if (!provider) return ["pstn missing PSTN_PROVIDER"];
  if (isPstnProvider(provider)) return [];
  return [`pstn invalid PSTN_PROVIDER ${provider}`];
}

function missingIssues(keys: string[]) {
  return keys
    .filter((key) => !process.env[key])
    .map((key) => `pstn missing ${key}`);
}

function webhookBaseUrlIssues() {
  const key = "PSTN_WEBHOOK_BASE_URL";
  const value = process.env[key];
  if (!value) return [];
  try {
    const parsed = new URL(value);
    const issues: string[] = [];
    if (parsed.protocol !== "https:") issues.push(`pstn invalid ${key}:https_required`);
    if (isLocalHost(parsed.hostname)) issues.push(`pstn invalid ${key}:public_host_required`);
    return issues;
  } catch {
    return [`pstn invalid ${key}`];
  }
}

function secretIssues() {
  const key = "PSTN_WEBHOOK_SECRET";
  const secret = process.env[key];
  return secret && secret.length < 32 ? [`pstn invalid ${key}`] : [];
}

function recordingDisclosureIssues() {
  return process.env.PSTN_RECORDING_DISCLOSURE_ENABLED === "true"
    ? []
    : ["pstn recording disclosure must be enabled"];
}

function maxCallMinutesIssues() {
  const value = process.env.PSTN_MAX_CALL_MINUTES;
  if (!value) return [];
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? []
    : ["pstn invalid PSTN_MAX_CALL_MINUTES"];
}

function maxCallMinutes() {
  const parsed = Number(process.env.PSTN_MAX_CALL_MINUTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function configured(key: string) {
  return process.env[key] ? "configured" : "configuration_required";
}

function isPstnEnabled(policy: string) {
  return policy === "domestic_pstn_bridge" || policy === "pstn_enabled";
}

function isPstnProvider(provider: string): provider is PstnProvider {
  return provider === "twilio" || provider === "telnyx" || provider === "domestic_bridge";
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1";
}
