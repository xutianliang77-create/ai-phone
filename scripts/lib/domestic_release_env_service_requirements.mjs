const requiredText = [
  "APPLE_IAP_BUNDLE_ID",
  "APPLE_IAP_ROOT_CERT_SHA256",
  "WECHAT_PAY_APP_ID",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_WEBHOOK_SECRET",
  "ALIPAY_APP_ID",
  "ALIPAY_MERCHANT_ID",
  "ALIPAY_WEBHOOK_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "DIAGNOSTICS_ADMIN_TOKEN",
  "DIAGNOSTICS_ONCALL_CONTACT",
  "DIAGNOSTICS_ALERT_WEBHOOK_SECRET",
  "AUTH_OTP_SECRET",
  "SMS_PROVIDER",
  "SMS_HTTP_API_KEY",
  "SMS_HTTP_TEMPLATE_ID",
  "SMS_SIGN_NAME",
  "REALTIME_PROVIDER",
  "MODEL_ROUTING_PROFILE",
  "TRANSLATION_PROVIDER",
  "TRANSLATION_MODEL",
  "TRANSLATION_API_KEY",
  "TRANSLATION_SERVICE_API_KEY",
  "ASR_HTTP_API_KEY",
  "ASR_SERVICE_API_KEY",
  "TTS_PROVIDER",
  "TTS_MODEL",
  "TTS_HTTP_API_KEY",
  "TTS_SERVICE_API_KEY",
  "INTERNAL_API_SECRET",
  "PUBLIC_RATE_LIMIT_KEY_SECRET",
];

const fullReleaseRequiredText = [
  "PSTN_BRIDGE_API_KEY",
  "PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET",
  "PSTN_BRIDGE_MEDIA_WRITER_API_KEY",
  "PSTN_BRIDGE_STATUS_WEBHOOK_SECRET",
  "PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY",
];

const requiredHttps = [
  "PUBLIC_CALL_BASE_URL",
  "PAYMENT_CALLBACK_BASE_URL",
  "DIAGNOSTICS_ALERT_WEBHOOK_URL",
  "TRANSLATION_BASE_URL",
  "ASR_HTTP_ENDPOINT",
  "ASR_HTTP_FLUSH_ENDPOINT",
  "TTS_HTTP_ENDPOINT",
  "SMS_HTTP_ENDPOINT",
];

const fullReleaseRequiredHttps = [
  "PSTN_BRIDGE_BASE_URL",
  "PSTN_BRIDGE_MEDIA_WRITER_ENDPOINT",
  "PSTN_BRIDGE_STATUS_WEBHOOK_ENDPOINT",
  "PSTN_BRIDGE_AUDIO_FRAME_SINK_ENDPOINT",
];

const secretMinimumLengths = {
  TRANSLATION_API_KEY: 16,
  TRANSLATION_SERVICE_API_KEY: 16,
  ASR_HTTP_API_KEY: 16,
  ASR_SERVICE_API_KEY: 16,
  QWEN_API_KEY: 16,
  TTS_HTTP_API_KEY: 16,
  TTS_SERVICE_API_KEY: 16,
  LIVEKIT_API_SECRET: 16,
  WECHAT_PAY_WEBHOOK_SECRET: 24,
  ALIPAY_WEBHOOK_SECRET: 24,
  DIAGNOSTICS_ADMIN_TOKEN: 16,
  DIAGNOSTICS_ALERT_WEBHOOK_SECRET: 16,
  PSTN_BRIDGE_API_KEY: 16,
  PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET: 16,
  PSTN_BRIDGE_MEDIA_WRITER_API_KEY: 16,
  PSTN_BRIDGE_STATUS_WEBHOOK_SECRET: 16,
  PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY: 16,
  PSTN_BRIDGE_UPSTREAM_API_KEY: 16,
  PSTN_BRIDGE_FONOSTER_API_KEY: 16,
  PSTN_BRIDGE_FONOSTER_API_SECRET: 16,
  INTERNAL_API_SECRET: 16,
  PUBLIC_RATE_LIMIT_KEY_SECRET: 32,
  AUTH_OTP_SECRET: 24,
  SMS_HTTP_API_KEY: 24,
};

export function requireDomesticReleaseServiceConfig(context) {
  requireText(context);
  requireHttps(context);
  requireSecretStrength(context);
  requireAppleRootFingerprint(context);
  requireLiveKit(context);
}

function requireText({ env, checks, issues, fullRelease }) {
  const keys = fullRelease
    ? [...requiredText, ...fullReleaseRequiredText]
    : requiredText;
  for (const key of keys) {
    const ok = hasRealValue(env[key]);
    record(checks, key, ok, { configured: ok });
    if (!ok) issues.push(`domestic release env missing ${key}`);
  }
}

function requireHttps({ env, checks, issues, fullRelease }) {
  const keys = fullRelease
    ? [...requiredHttps, ...fullReleaseRequiredHttps]
    : requiredHttps;
  for (const key of keys) {
    const ok = isPublicUrl(env[key], ["https:"]);
    record(checks, key, ok, { value: mask(env[key]) });
    if (!ok) issues.push(`domestic release env invalid ${key}`);
  }
}

function requireSecretStrength({ env, checks, issues, fullRelease }) {
  for (const [key, minLength] of Object.entries(secretMinimumLengths)) {
    if (!fullRelease && key.startsWith("PSTN_")) continue;
    const value = env[key];
    if (!hasRealValue(value)) continue;
    const ok = value.trim().length >= minLength;
    record(checks, `${key}_strength`, ok, {
      minLength,
      actualLength: value.trim().length,
    });
    if (!ok) issues.push(`domestic release env weak ${key}`);
  }
}

function requireAppleRootFingerprint({ env, checks, issues }) {
  const value = env.APPLE_IAP_ROOT_CERT_SHA256;
  if (!hasRealValue(value)) return;
  const ok = /^[a-f0-9]{64}$/i.test(value.trim());
  record(checks, "APPLE_IAP_ROOT_CERT_SHA256_format", ok, {
    expected: "64 hex characters",
  });
  if (!ok) issues.push("domestic release env invalid APPLE_IAP_ROOT_CERT_SHA256");
}

function requireLiveKit({ env, checks, issues }) {
  const ok = isPublicUrl(env.LIVEKIT_URL, ["wss:", "https:"]);
  record(checks, "LIVEKIT_URL", ok, { value: mask(env.LIVEKIT_URL) });
  if (!ok) issues.push("domestic release env invalid LIVEKIT_URL");
}

function isPublicUrl(value, protocols) {
  if (!hasRealValue(value)) return false;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function hasRealValue(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    !/required|replace|example|your-|todo|待填|translation\.local|localhost|127\.0\.0\.1|0\.0\.0\.0/i
      .test(value);
}

function mask(value = "") {
  if (!value) return "";
  if (/^https?:|^wss?:/.test(value)) return value;
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
