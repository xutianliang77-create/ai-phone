import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  checkModelRoutingConfig,
  renderModelRoutingEnv,
} from "./model_routing_config.mjs";

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
  "PSTN_BRIDGE_API_KEY",
  "PSTN_BRIDGE_PROVIDER_WEBHOOK_SECRET",
  "PSTN_BRIDGE_MEDIA_WRITER_API_KEY",
  "PSTN_BRIDGE_STATUS_WEBHOOK_SECRET",
  "PSTN_BRIDGE_AUDIO_FRAME_SINK_API_KEY",
  "INTERNAL_API_SECRET",
];

const requiredHttps = [
  "PUBLIC_CALL_BASE_URL",
  "PAYMENT_CALLBACK_BASE_URL",
  "DIAGNOSTICS_ALERT_WEBHOOK_URL",
  "TRANSLATION_BASE_URL",
  "ASR_HTTP_ENDPOINT",
  "ASR_HTTP_FLUSH_ENDPOINT",
  "TTS_HTTP_ENDPOINT",
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
};

export function checkDomesticReleaseEnvFile(options = {}) {
  const root = options.root ?? process.cwd();
  const filePath = path.resolve(
    root,
    options.file ?? "release/domestic/release.env",
  );
  if (!existsSync(filePath)) {
    return result(
      filePath,
      [],
      [`domestic release env file missing: ${filePath}`],
    );
  }
  const env = parseEnvFile(readFileSync(filePath, "utf8"));
  const checks = [];
  const issues = [];
  requireText(env, checks, issues);
  requireHttps(env, checks, issues);
  requireSecretStrength(env, checks, issues);
  requireAppleRootFingerprint(env, checks, issues);
  requireLiveKit(env, checks, issues);
  requireFixedValues(env, checks, issues);
  requireReleaseArtifact(root, env, checks, issues, "RELEASE_MATERIALS_FILE");
  requireReleaseArtifact(root, env, checks, issues, "MODEL_SELECTION_FILE");
  requireReleaseArtifact(root, env, checks, issues, "MODEL_ROUTING_FILE");
  requireModelRouting(root, env, checks, issues);
  requirePstnProvider(env, checks, issues);
  return result(filePath, checks, issues);
}

export function parseEnvFile(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice(7).trim()
      : trimmed;
    const index = normalized.indexOf("=");
    if (index === -1) continue;
    const key = normalized.slice(0, index).trim();
    env[key] = unquote(normalized.slice(index + 1).trim());
  }
  return env;
}

function requireText(env, checks, issues) {
  for (const key of requiredText) {
    const ok = hasRealValue(env[key]);
    record(checks, key, ok, { configured: ok });
    if (!ok) issues.push(`domestic release env missing ${key}`);
  }
}

function requireSecretStrength(env, checks, issues) {
  for (const [key, minLength] of Object.entries(secretMinimumLengths)) {
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

function requireAppleRootFingerprint(env, checks, issues) {
  const value = env.APPLE_IAP_ROOT_CERT_SHA256;
  if (!hasRealValue(value)) return;
  const ok = /^[a-f0-9]{64}$/i.test(value.trim());
  record(checks, "APPLE_IAP_ROOT_CERT_SHA256_format", ok, {
    expected: "64 hex characters",
  });
  if (!ok) {
    issues.push("domestic release env invalid APPLE_IAP_ROOT_CERT_SHA256");
  }
}

function requireHttps(env, checks, issues) {
  for (const key of requiredHttps) {
    const ok = isPublicUrl(env[key], ["https:"]);
    record(checks, key, ok, { value: mask(env[key]) });
    if (!ok) issues.push(`domestic release env invalid ${key}`);
  }
}

function requireLiveKit(env, checks, issues) {
  const ok = isPublicUrl(env.LIVEKIT_URL, ["wss:", "https:"]);
  record(checks, "LIVEKIT_URL", ok, { value: mask(env.LIVEKIT_URL) });
  if (!ok) issues.push("domestic release env invalid LIVEKIT_URL");
}

function requireFixedValues(env, checks, issues) {
  fixedValue(env, checks, issues, "REGION_EDITION", "domestic");
  fixedValue(env, checks, issues, "DATA_REGION", "cn");
  fixedValue(env, checks, issues, "COMPLIANCE_PROFILE", "pipl");
  fixedValue(env, checks, issues, "REALTIME_PROVIDER", "hymt2_self_hosted");
  fixedValue(env, checks, issues, "TRANSLATION_PROVIDER", "hymt2_self_hosted");
  fixedValue(env, checks, issues, "TRANSLATION_MODEL", "tencent/Hy-MT2-1.8B");
  fixedValue(env, checks, issues, "CALL_ROOM_PROVIDER", "livekit");
  fixedValue(env, checks, issues, "TTS_PROVIDER", "voxcpm2");
  fixedValue(env, checks, issues, "TTS_MODEL", "VoxCPM2");
  fixedValue(env, checks, issues, "APPLE_IAP_ENVIRONMENT", "Production");
  fixedValue(env, checks, issues, "PSTN_RECORDING_DISCLOSURE_ENABLED", "true");
  oneOf(env, checks, issues, "DIAGNOSTICS_ALERT_WEBHOOK_FORMAT", [
    "generic",
    "wecom",
    "feishu",
    "dingtalk",
  ]);
}

function requireReleaseArtifact(root, env, checks, issues, key) {
  const value = env[key];
  const ok = hasRealValue(value) && existsSync(path.resolve(root, value));
  record(checks, key, ok, { path: value ?? "" });
  if (!ok) issues.push(`domestic release env invalid ${key}`);
}

function requireModelRouting(root, env, checks, issues) {
  if (!hasRealValue(env.MODEL_ROUTING_FILE)) return;
  const result = checkModelRoutingConfig(path.resolve(root, env.MODEL_ROUTING_FILE));
  const ok = result.status === "ready";
  record(checks, "MODEL_ROUTING_FILE_readiness", ok, {
    status: result.status,
    activeProfile: env.MODEL_ROUTING_PROFILE,
  });
  if (!ok) {
    issues.push("domestic release env invalid MODEL_ROUTING_FILE readiness");
    issues.push(...result.issues);
  }
  try {
    const rendered = renderModelRoutingEnv(
      path.resolve(root, env.MODEL_ROUTING_FILE),
      env.MODEL_ROUTING_PROFILE,
    );
    record(checks, "MODEL_ROUTING_PROFILE_readiness", true, {
      profile: rendered.profile,
      groups: Object.keys(rendered.groups),
    });
  } catch (error) {
    record(checks, "MODEL_ROUTING_PROFILE_readiness", false, {
      message: errorMessage(error),
    });
    issues.push("domestic release env invalid MODEL_ROUTING_PROFILE");
  }
}

function requirePstnProvider(env, checks, issues) {
  oneOf(env, checks, issues, "PSTN_BRIDGE_PROVIDER", ["http", "fonoster"]);
  if (env.PSTN_BRIDGE_PROVIDER === "fonoster") {
    requireTextKeys(env, checks, issues, [
      "PSTN_BRIDGE_FONOSTER_ACCESS_KEY_ID",
      "PSTN_BRIDGE_FONOSTER_API_KEY",
      "PSTN_BRIDGE_FONOSTER_API_SECRET",
      "PSTN_BRIDGE_FONOSTER_APP_REF",
      "PSTN_BRIDGE_FONOSTER_FROM_NUMBER",
    ]);
    requireHttpsKeys(env, checks, issues, ["PSTN_BRIDGE_FONOSTER_BASE_URL"]);
    return;
  }
  requireTextKeys(env, checks, issues, ["PSTN_BRIDGE_UPSTREAM_API_KEY"]);
  requireHttpsKeys(env, checks, issues, ["PSTN_BRIDGE_UPSTREAM_BASE_URL"]);
}

function requireTextKeys(env, checks, issues, keys) {
  for (const key of keys) {
    const ok = hasRealValue(env[key]);
    record(checks, key, ok, { configured: ok });
    if (!ok) issues.push(`domestic release env missing ${key}`);
  }
}

function requireHttpsKeys(env, checks, issues, keys) {
  for (const key of keys) {
    const ok = isPublicUrl(env[key], ["https:"]);
    record(checks, key, ok, { value: mask(env[key]) });
    if (!ok) issues.push(`domestic release env invalid ${key}`);
  }
}

function fixedValue(env, checks, issues, key, expected) {
  const ok = env[key] === expected;
  record(checks, key, ok, { expected, actual: env[key] ?? "" });
  if (!ok) issues.push(`domestic release env ${key} must be ${expected}`);
}

function oneOf(env, checks, issues, key, allowed) {
  const ok = allowed.includes(env[key]);
  record(checks, key, ok, { allowed, actual: env[key] ?? "" });
  if (!ok) issues.push(`domestic release env invalid ${key}`);
}

function isPublicUrl(value, protocols) {
  if (!hasRealValue(value)) return false;
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol) && !isLocalHost(url.hostname);
  } catch {
    return false;
  }
}

function hasRealValue(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !isPlaceholder(value)
  );
}

function isPlaceholder(value) {
  return /required|replace|example|your-|todo|待填|translation\.local|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(
    value,
  );
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
}

function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

function mask(value = "") {
  if (!value) return "";
  if (/^https?:|^wss?:/.test(value)) return value;
  return value.length <= 6
    ? "***"
    : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function result(filePath, checks, issues) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    filePath,
    checks,
    issues,
    actions:
      issues.length === 0
        ? []
        : [
            "Fill release/domestic/release.env from real production service credentials and rerun this check.",
          ],
  };
}
