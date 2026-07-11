import { existsSync, readFileSync, statSync } from "node:fs";

export function loadWaitDeviceEvidence(
  readinessJson,
  waitLog,
  maxAgeHours,
  nowMs = Date.now(),
) {
  const readiness = loadReadiness(readinessJson, maxAgeHours, nowMs);
  const log = loadLog(waitLog, maxAgeHours, nowMs);
  const devices = readiness.payload?.devices ?? [];
  const actions = devices.flatMap((device) =>
    (device.actions ?? []).map((action) => `${device.name ?? "unknown"}: ${action}`)
  );

  return {
    readinessPath: readinessJson,
    logPath: waitLog,
    readiness,
    log,
    ready: readiness.payload?.ready ?? false,
    requestedDevice: readiness.payload?.requestedDevice ?? null,
    physicalDeviceCount: readiness.payload?.physicalDeviceCount ?? null,
    matchedDeviceCount: readiness.payload?.matchedDeviceCount ?? null,
    devices: devices.map(deviceSummary),
    issues: waitDeviceIssues(readiness, log),
    actions,
  };
}

function loadReadiness(file, maxAgeHours, nowMs) {
  if (!existsSync(file)) {
    return missingFile(file, maxAgeHours, "readiness JSON is missing");
  }
  const content = readFileSync(file, "utf8");
  const payload = parseJson(content);
  return {
    path: file,
    exists: true,
    valid: Boolean(payload),
    payload,
    ...fileFreshness(file, maxAgeHours, nowMs),
  };
}

function loadLog(file, maxAgeHours, nowMs) {
  if (!existsSync(file)) {
    return missingFile(file, maxAgeHours, "wait-device log is missing");
  }
  const content = readFileSync(file, "utf8");
  return {
    path: file,
    exists: true,
    valid: true,
    attempted: content.includes("Attempt "),
    reportRefreshed: content.includes("Refreshing MVP acceptance report"),
    timedOut: content.includes("Timed out") || content.includes("Timeout: 0s"),
    ...fileFreshness(file, maxAgeHours, nowMs),
  };
}

function missingFile(path, maxAgeHours, issue) {
  return {
    path,
    exists: false,
    valid: false,
    fresh: false,
    freshness: "missing",
    modifiedAt: null,
    ageHours: null,
    maxAgeHours,
    issue,
  };
}

function fileFreshness(file, maxAgeHours, nowMs) {
  const modifiedMs = statSync(file).mtimeMs;
  const ageHours = (nowMs - modifiedMs) / 36e5;
  const fresh = ageHours >= 0 && ageHours <= maxAgeHours;
  return {
    fresh,
    freshness: fresh ? "fresh" : "stale",
    modifiedAt: new Date(modifiedMs).toISOString(),
    ageHours: Number(ageHours.toFixed(2)),
    maxAgeHours,
  };
}

function waitDeviceIssues(readiness, log) {
  return [
    readiness.issue,
    log.issue,
    readiness.exists && !readiness.valid ? "readiness JSON is invalid" : null,
    readiness.exists && !readiness.fresh ? "readiness JSON is stale" : null,
    log.exists && !log.fresh ? "wait-device log is stale" : null,
  ].filter(Boolean);
}

function deviceSummary(device) {
  return {
    name: device.name ?? "unknown",
    model: device.model ?? "unknown",
    osVersion: device.osVersion ?? "unknown",
    pairingState: device.pairingState ?? "unknown",
    developerModeStatus: device.developerModeStatus ?? "unknown",
    tunnelState: device.tunnelState ?? "unknown",
    ready: device.ready ?? false,
    matched: device.matched ?? false,
    actions: device.actions ?? [],
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
