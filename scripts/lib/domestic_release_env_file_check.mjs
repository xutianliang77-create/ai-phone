import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  checkModelRoutingConfig,
  renderModelRoutingEnv,
} from "./model_routing_config.mjs";
import { requireReleaseSecurity } from "./domestic_release_security_check.mjs";
import { requireDomesticReleaseServiceConfig } from
  "./domestic_release_env_service_requirements.mjs";

const releaseProfiles = ["core_translation", "commercial_full"];
const deferredCapabilities = ["livekit_sip", "agent", "egress"];

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
      null,
    );
  }
  const env = parseEnvFile(readFileSync(filePath, "utf8"));
  const checks = [];
  const issues = [];
  const profile = requireReleaseProfile(env, checks, issues);
  const fullRelease = profile === "commercial_full";
  requireDomesticReleaseServiceConfig({ env, checks, issues, fullRelease });
  requireFixedValues(env, checks, issues, profile);
  requireReleaseArtifact(root, env, checks, issues, "RELEASE_MATERIALS_FILE");
  requireReleaseArtifact(root, env, checks, issues, "MODEL_SELECTION_FILE");
  requireReleaseArtifact(root, env, checks, issues, "MODEL_ROUTING_FILE");
  requireModelRouting(root, env, checks, issues);
  if (fullRelease) requirePstnProvider(env, checks, issues);
  requireReleaseSecurity(filePath, env, checks, issues);
  return result(filePath, checks, issues, profile);
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

function requireReleaseProfile(env, checks, issues) {
  oneOf(
    env,
    checks,
    issues,
    "DOMESTIC_RELEASE_CAPABILITY_PROFILE",
    releaseProfiles,
  );
  return releaseProfiles.includes(env.DOMESTIC_RELEASE_CAPABILITY_PROFILE)
    ? env.DOMESTIC_RELEASE_CAPABILITY_PROFILE
    : null;
}

function requireFixedValues(env, checks, issues, profile) {
  fixedValue(env, checks, issues, "NODE_ENV", "production");
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
  fixedValue(env, checks, issues, "API_TEST_AUTO_ACCOUNT", "false");
  fixedValue(env, checks, issues, "AUTH_DEBUG_OTP", "false");
  fixedValue(env, checks, issues, "REALTIME_ALLOW_QUERY_TOKEN", "false");
  fixedValue(env, checks, issues, "SMS_PROVIDER", "http");
  boundedInteger(env, checks, issues, "SMS_HTTP_TIMEOUT_MS", 1000, 30000);
  oneOf(env, checks, issues, "DIAGNOSTICS_ALERT_WEBHOOK_FORMAT", [
    "generic",
    "wecom",
    "feishu",
    "dingtalk",
  ]);
  if (profile === "core_translation") {
    fixedValue(env, checks, issues, "CALL_PROVIDER_POLICY", "call_link_only");
    fixedValue(env, checks, issues, "AGENT_CALL_WORKER_ENABLED", "false");
    fixedValue(env, checks, issues, "VOICE_AGENT_ENABLED", "false");
    fixedValue(env, checks, issues, "VOICE_AGENT_ASSIST_ENABLED", "false");
    fixedValue(env, checks, issues, "VOICE_AGENT_AUTONOMOUS_ENABLED", "false");
    fixedValue(
      env,
      checks,
      issues,
      "VOICE_AGENT_OPERATOR_CONSULT_ENABLED",
      "false",
    );
    fixedValue(env, checks, issues, "LIVEKIT_EGRESS_ENABLED", "false");
    fixedValue(
      env,
      checks,
      issues,
      "LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED",
      "false",
    );
  }
  if (profile === "commercial_full") {
    fixedValue(env, checks, issues, "PSTN_RECORDING_DISCLOSURE_ENABLED", "true");
    oneOf(env, checks, issues, "CALL_PROVIDER_POLICY", [
      "domestic_pstn_bridge",
      "pstn_enabled",
    ]);
    fixedValue(env, checks, issues, "AGENT_CALL_WORKER_ENABLED", "true");
    fixedValue(env, checks, issues, "VOICE_AGENT_ENABLED", "true");
    fixedValue(env, checks, issues, "VOICE_AGENT_ASSIST_ENABLED", "true");
    fixedValue(env, checks, issues, "LIVEKIT_EGRESS_ENABLED", "true");
    fixedValue(
      env,
      checks,
      issues,
      "LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED",
      "true",
    );
  }
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

function boundedInteger(env, checks, issues, key, minimum, maximum) {
  const value = Number(env[key]);
  const ok = Number.isInteger(value) && value >= minimum && value <= maximum;
  record(checks, key, ok, {
    minimum,
    maximum,
    actual: env[key] ?? "",
  });
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

function result(filePath, checks, issues, profile) {
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    filePath,
    profile,
    deferredCapabilities:
      profile === "core_translation" ? deferredCapabilities : [],
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
