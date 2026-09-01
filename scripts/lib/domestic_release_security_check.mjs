import { statSync } from "node:fs";

export function requireReleaseSecurity(
  filePath,
  env,
  checks,
  issues,
  options = {},
) {
  requirePrivateFileMode(filePath, checks, issues);
  fixedValue(env, checks, issues, "PUBLIC_RATE_LIMIT_PROVIDER", "redis");
  const redisUrlOk = options.fullRelease
    ? publicTlsRedisUrl(env.PUBLIC_RATE_LIMIT_REDIS_URL)
    : coreRedisUrl(env.PUBLIC_RATE_LIMIT_REDIS_URL);
  record(checks, "PUBLIC_RATE_LIMIT_REDIS_URL", redisUrlOk, {
    value: mask(env.PUBLIC_RATE_LIMIT_REDIS_URL),
  });
  if (!redisUrlOk) {
    issues.push("domestic release env invalid PUBLIC_RATE_LIMIT_REDIS_URL");
  }
  for (const key of ["AUTH_TEST_PHONE", "AUTH_TEST_CODE"]) {
    const ok = !hasRealValue(env[key]);
    record(checks, `${key}_absent`, ok, { configured: !ok });
    if (!ok) issues.push(`domestic release env forbids ${key}`);
  }
}

function coreRedisUrl(value) {
  if (!hasConfiguredValue(value)) return false;
  try {
    const url = new URL(value);
    return ["redis:", "rediss:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function hasConfiguredValue(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    !/required|replace|example|your-|todo|待填|translation\.local/i.test(value);
}

function requirePrivateFileMode(filePath, checks, issues) {
  const mode = statSync(filePath).mode & 0o777;
  const ok = (mode & 0o077) === 0 && (mode & 0o400) !== 0;
  record(checks, "RELEASE_ENV_FILE_MODE", ok, {
    mode: mode.toString(8).padStart(3, "0"),
  });
  if (!ok) issues.push("domestic release env must be owner-only (0600 or 0400)");
}

function publicTlsRedisUrl(value) {
  if (!hasRealValue(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "rediss:" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function fixedValue(env, checks, issues, key, expected) {
  const ok = env[key] === expected;
  record(checks, key, ok, { expected, actual: env[key] ?? "" });
  if (!ok) issues.push(`domestic release env ${key} must be ${expected}`);
}

function hasRealValue(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    !/required|replace|example|your-|todo|待填|translation\.local|localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value);
}

function mask(value = "") {
  return value.length <= 6 ? "***" : `${value.slice(0, 3)}***${value.slice(-2)}`;
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}
