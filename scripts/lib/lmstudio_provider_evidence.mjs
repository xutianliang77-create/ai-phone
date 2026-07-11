import { existsSync, readFileSync, statSync } from "node:fs";

export function loadLmStudioProviderEvidence(
  providerJson,
  maxAgeHours,
  nowMs = Date.now(),
) {
  if (!existsSync(providerJson)) {
    return {
      path: providerJson,
      exists: false,
      pass: false,
      status: "missing",
      freshness: "missing",
      modifiedAt: null,
      ageHours: null,
      maxAgeHours,
      issues: ["LM Studio provider evidence file is missing."],
      actions: ["Run `npm run ios:nemotron:check-lmstudio -- --json` or `npm run ios:nemotron:run` before final iPhone smoke."],
    };
  }
  const payload = parseJson(readFileSync(providerJson, "utf8")) ?? {};
  const freshness = fileFreshness(providerJson, maxAgeHours, nowMs);
  const ready = payload.status === "ready" && Boolean(payload.translation);
  const issues = [...(payload.issues ?? [])];
  if (!ready) issues.push("LM Studio did not return a ready non-empty translation.");
  return {
    ...payload,
    path: providerJson,
    exists: true,
    ...freshness,
    pass: ready && freshness.fresh,
    issues,
    actions: payload.actions ?? [],
  };
}

function fileFreshness(file, maxAgeHours, nowMs) {
  const modifiedMs = statSync(file).mtimeMs;
  const ageHours = (nowMs - modifiedMs) / 36e5;
  const fresh = ageHours >= -1 / 60 && ageHours <= maxAgeHours;
  return {
    fresh,
    freshness: fresh ? "fresh" : "stale",
    modifiedAt: new Date(modifiedMs).toISOString(),
    ageHours: Number(ageHours.toFixed(2)),
    maxAgeHours,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
