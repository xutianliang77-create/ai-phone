import type { EnterpriseFeatureReadiness } from
  "./enterprise-communication-policy.js";

type RuntimeReadiness = {
  asr: EnterpriseFeatureReadiness;
  translation: EnterpriseFeatureReadiness;
  tts: EnterpriseFeatureReadiness;
};

export function enterpriseMeetingRuntimeReadiness(
  env: Record<string, string | undefined> = process.env,
  now = new Date(),
): RuntimeReadiness {
  const fallback = unavailable(now);
  const raw = env.ENTERPRISE_MEETING_RUNTIME_READINESS_JSON?.trim();
  if (!raw || Buffer.byteLength(raw) > 8_192) return fallback;
  try {
    const value = JSON.parse(raw) as unknown;
    return validRuntimeReadiness(value, now) ? value : fallback;
  } catch {
    return fallback;
  }
}

function validRuntimeReadiness(
  value: unknown,
  now: Date,
): value is RuntimeReadiness {
  if (!record(value) || !validDate(now) ||
    !exactKeys(value, ["asr", "translation", "tts"])) return false;
  return [value.asr, value.translation, value.tts].every((feature) =>
    record(feature) && exactKeys(feature, ["device", "cloud"]) &&
    validEngine(feature.device, now) && validEngine(feature.cloud, now)
  );
}

function validEngine(value: unknown, now: Date) {
  if (!record(value) || !exactKeys(value, [
    "status", "checkedAt", "expiresAt",
  ], ["fingerprint"])) return false;
  const status = value.status;
  const checkedAt = timestamp(value.checkedAt);
  const expiresAt = timestamp(value.expiresAt);
  const fingerprint = value.fingerprint;
  if (!["ready", "not_ready", "not_configured", "degraded"].includes(
    String(status),
  ) || checkedAt === null || expiresAt === null ||
    checkedAt > now.getTime() + 30_000 || expiresAt < checkedAt) return false;
  if (status === "ready") {
    return typeof fingerprint === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(fingerprint) &&
      expiresAt > now.getTime();
  }
  return fingerprint === undefined || typeof fingerprint === "string";
}

function unavailable(now: Date): RuntimeReadiness {
  const timestamp = validDate(now) ? now.toISOString() : new Date(0).toISOString();
  const feature = () => ({
    device: { status: "not_configured" as const, checkedAt: timestamp,
      expiresAt: timestamp },
    cloud: { status: "not_configured" as const, checkedAt: timestamp,
      expiresAt: timestamp },
  });
  return { asr: feature(), translation: feature(), tts: feature() };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}
function timestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null;
}
function validDate(value: Date) {
  return Number.isFinite(value.getTime());
}
