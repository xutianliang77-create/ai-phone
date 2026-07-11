import type { PstnBridgeEnv, PstnBridgeProviderName } from "./types.js";

export function loadEnv(env: NodeJS.ProcessEnv = process.env): PstnBridgeEnv {
  return {
    port: Number(env.PSTN_BRIDGE_PORT ?? 3302),
    apiKey: clean(env.PSTN_BRIDGE_API_KEY),
    provider: parseProvider(env.PSTN_BRIDGE_PROVIDER),
    upstreamBaseUrl: clean(env.PSTN_BRIDGE_UPSTREAM_BASE_URL),
    upstreamApiKey: clean(env.PSTN_BRIDGE_UPSTREAM_API_KEY),
    upstreamTimeoutMs: Number(env.PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS ?? 10000),
    fonosterBaseUrl: clean(env.PSTN_BRIDGE_FONOSTER_BASE_URL),
    fonosterAccessKeyId: clean(env.PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID),
    fonosterApiKey: clean(env.PSTN_BRIDGE_FONOSTER_API_KEY),
    fonosterApiSecret: clean(env.PSTN_BRIDGE_FONOSTER_API_SECRET),
    fonosterAppRef: clean(env.PSTN_BRIDGE_FONOSTER_APP_REF),
    fonosterFromNumber: clean(env.PSTN_BRIDGE_FONOSTER_FROM_NUMBER),
    fonosterCallTimeoutSeconds: Number(env.PSTN_BRIDGE_FONOSTER_CALL_TIMEOUT_SECONDS ?? 60),
    mediaWriterEndpoint: clean(env.PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT),
    mediaWriterApiKey: clean(env.PSTN_BRIDGE_MEDIA_WRITER_API_KEY),
    mediaWriterTimeoutMs: Number(env.PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS ?? 5000),
    statusWebhookEndpoint: clean(env.PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT),
    statusWebhookSecret: clean(env.PSTN_BRIDGE_STATUS_WEBHOOK_SECRET),
    statusWebhookTimeoutMs: Number(env.PSTN_BRIDGE_STATUS_WEBHOOK_TIMEOUT_MS ?? 5000),
    statusWebhookRetryCount: Number(env.PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT ?? 2),
    statusWebhookRetryDelayMs: Number(env.PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_DELAY_MS ?? 250),
    audioFrameSinkEndpoint: clean(env.PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT),
    audioFrameSinkApiKey: clean(env.PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY),
    audioFrameSinkTimeoutMs: Number(env.PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS ?? 5000),
    providerWebhookSecret: clean(env.PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET),
    providerWebhookMaxSkewMs: Number(env.PSTN_BRIDGE_PROVIDER_WEBHOOK_MAX_SKEW_MS ?? 300000),
    recordingDisclosureEnabled: env.PSTN_RECORDING_DISCLOSURE_ENABLED === "true",
  };
}

export function checkReleaseReadiness(config: PstnBridgeEnv) {
  const issues = [
    ...required("PSTN_BRIDGE_API_KEY", config.apiKey),
    ...validPort(config.port),
    ...validTimeout(config.upstreamTimeoutMs),
    ...realProvider(config.provider),
    ...requiredProviderSettings(config),
    ...requiredMediaWriter(config),
    ...requiredStatusWebhook(config),
    ...requiredAudioFrameSink(config),
    ...requiredProviderWebhook(config),
    ...recordingDisclosure(config.recordingDisclosureEnabled),
  ];
  return { status: issues.length === 0 ? "ready" : "not_ready", issues };
}

function parseProvider(value: string | undefined): PstnBridgeProviderName {
  return value === "http" || value === "fonoster" ? value : "mock";
}

function clean(value: string | undefined) {
  return value?.trim() || undefined;
}

function required(name: string, value: string | undefined) {
  return value ? [] : [`pstn_bridge missing ${name}`];
}

function validPort(port: number) {
  return Number.isInteger(port) && port > 0 && port < 65536
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_PORT"];
}

function validTimeout(timeoutMs: number) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_UPSTREAM_TIMEOUT_MS"];
}

function validMediaTimeout(timeoutMs: number) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_MEDIA_WRITER_TIMEOUT_MS"];
}

function validStatusWebhookTimeout(timeoutMs: number) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_STATUS_WEBHOOK_TIMEOUT_MS"];
}

function validStatusWebhookRetryCount(retryCount: number) {
  return Number.isInteger(retryCount) && retryCount >= 0 && retryCount <= 5
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_COUNT"];
}

function validStatusWebhookRetryDelay(delayMs: number) {
  return Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 10000
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_STATUS_WEBHOOK_RETRY_DELAY_MS"];
}

function validFrameSinkTimeout(timeoutMs: number) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_AUDIO_FRAME_SINK_TIMEOUT_MS"];
}

function validWebhookSkew(timeoutMs: number) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_PROVIDER_WEBHOOK_MAX_SKEW_MS"];
}

function realProvider(provider: PstnBridgeProviderName) {
  return provider === "mock" ? ["pstn_bridge provider must not be mock for release"] : [];
}

function recordingDisclosure(enabled: boolean) {
  return enabled ? [] : ["pstn_bridge missing PSTN_RECORDING_DISCLOSURE_ENABLED=true"];
}

function requiredProviderSettings(config: PstnBridgeEnv) {
  return config.provider === "fonoster"
    ? requiredFonosterSettings(config)
    : requiredHttpSettings(config);
}

function requiredHttpSettings(config: PstnBridgeEnv) {
  return [
    ...publicHttpsUrl("PSTN_BRIDGE_UPSTREAM_BASE_URL", config.upstreamBaseUrl),
    ...required("PSTN_BRIDGE_UPSTREAM_API_KEY", config.upstreamApiKey),
  ];
}

function requiredFonosterSettings(config: PstnBridgeEnv) {
  return [
    ...publicHttpsUrl("PSTN_BRIDGE_FONOSTER_BASE_URL", config.fonosterBaseUrl),
    ...required("PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID", config.fonosterAccessKeyId),
    ...required("PSTN_BRIDGE_FONOSTER_API_KEY", config.fonosterApiKey),
    ...required("PSTN_BRIDGE_FONOSTER_API_SECRET", config.fonosterApiSecret),
    ...required("PSTN_BRIDGE_FONOSTER_APP_REF", config.fonosterAppRef),
    ...required("PSTN_BRIDGE_FONOSTER_FROM_NUMBER", config.fonosterFromNumber),
    ...validFonosterCallTimeout(config.fonosterCallTimeoutSeconds),
  ];
}

function validFonosterCallTimeout(timeoutSeconds: number | undefined) {
  return typeof timeoutSeconds === "number"
    && Number.isInteger(timeoutSeconds)
    && timeoutSeconds > 0
    && timeoutSeconds <= 600
    ? []
    : ["pstn_bridge invalid PSTN_BRIDGE_FONOSTER_CALL_TIMEOUT_SECONDS"];
}

function requiredMediaWriter(config: PstnBridgeEnv) {
  return [
    ...publicHttpsUrl("PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT", config.mediaWriterEndpoint),
    ...required("PSTN_BRIDGE_MEDIA_WRITER_API_KEY", config.mediaWriterApiKey),
    ...validMediaTimeout(config.mediaWriterTimeoutMs),
  ];
}

function requiredStatusWebhook(config: PstnBridgeEnv) {
  return [
    ...publicHttpsUrl("PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT", config.statusWebhookEndpoint),
    ...required("PSTN_BRIDGE_STATUS_WEBHOOK_SECRET", config.statusWebhookSecret),
    ...validStatusWebhookTimeout(config.statusWebhookTimeoutMs),
    ...validStatusWebhookRetryCount(config.statusWebhookRetryCount),
    ...validStatusWebhookRetryDelay(config.statusWebhookRetryDelayMs),
  ];
}

function requiredAudioFrameSink(config: PstnBridgeEnv) {
  return [
    ...publicHttpsUrl("PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT", config.audioFrameSinkEndpoint),
    ...required("PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY", config.audioFrameSinkApiKey),
    ...validFrameSinkTimeout(config.audioFrameSinkTimeoutMs),
  ];
}

function requiredProviderWebhook(config: PstnBridgeEnv) {
  return [
    ...required("PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET", config.providerWebhookSecret),
    ...validWebhookSkew(config.providerWebhookMaxSkewMs),
  ];
}

function publicHttpsUrl(name: string, value: string | undefined) {
  if (!value) return [`pstn_bridge missing ${name}`];
  try {
    const url = new URL(value);
    const host = url.hostname;
    const publicHost = host !== "localhost" && host !== "127.0.0.1" && host !== "0.0.0.0";
    return url.protocol === "https:" && publicHost ? [] : [`pstn_bridge invalid ${name}`];
  } catch {
    return [`pstn_bridge invalid ${name}`];
  }
}
