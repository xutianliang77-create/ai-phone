import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export function signedBuildEvidenceGate({ root, deviceReady, nowMs = Date.now() }) {
  const evidencePath = signedBuildEvidencePath(root);
  if (!deviceReady) {
    return {
      name: "ios_signed_device_build",
      status: "pending",
      message: "waiting for physical_iphone_readiness before signed iPhoneOS build is required",
      details: { path: evidencePath },
    };
  }

  const evidence = loadSignedBuildEvidence(evidencePath, nowMs);
  if (!evidence.exists) {
    return {
      name: "ios_signed_device_build",
      status: "fail",
      message: `signed build evidence missing; run IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true npm run ios:nemotron:preflight`,
      details: { path: evidencePath },
    };
  }
  if (!evidence.fresh) {
    return {
      name: "ios_signed_device_build",
      status: "fail",
      message: `signed build evidence is stale: age=${evidence.ageHours}h max=${evidence.maxAgeHours}h`,
      details: evidence,
    };
  }
  if (evidence.status !== "pass") {
    return {
      name: "ios_signed_device_build",
      status: "fail",
      message: evidence.message || `signed build status is ${evidence.status}`,
      details: evidence,
    };
  }
  return {
    name: "ios_signed_device_build",
    status: "pass",
    message: `signed iPhoneOS build passed; app=${evidence.deviceApp}; log=${evidence.logPath}`,
    details: evidence,
  };
}

function signedBuildEvidencePath(root) {
  const logDir = process.env.LOG_DIR ||
    path.join(root, ".cache/ios-nemotron-services");
  return path.resolve(
    process.env.SIGNED_BUILD_JSON ||
      process.env.IOS_NEMOTRON_SIGNED_BUILD_JSON ||
      path.join(logDir, "signed-build.json"),
  );
}

function loadSignedBuildEvidence(evidencePath, nowMs) {
  if (!existsSync(evidencePath)) return { exists: false, path: evidencePath };
  const payload = parseJson(readFileSync(evidencePath, "utf8"));
  if (!payload) {
    return {
      exists: true,
      path: evidencePath,
      fresh: false,
      status: "invalid",
      message: "signed build evidence JSON is invalid",
    };
  }
  const maxAgeHours = Number(process.env.IOS_SIGNED_BUILD_MAX_AGE_HOURS ?? "24");
  const generatedMs = Date.parse(payload.generatedAt ?? "");
  const ageHours = Number.isNaN(generatedMs)
    ? null
    : Number(((nowMs - generatedMs) / 36e5).toFixed(2));
  const fresh = ageHours !== null && ageHours <= maxAgeHours;
  return {
    ...payload,
    exists: true,
    path: evidencePath,
    fresh,
    ageHours,
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
