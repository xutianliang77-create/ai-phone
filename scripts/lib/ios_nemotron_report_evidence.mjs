import { existsSync, readFileSync, statSync } from "node:fs";
import { smokeStructuredResultIssues } from "./ios_nemotron_smoke_result_requirements.mjs";
import { signedBuildDiagnosis } from "./ios_nemotron_signed_build_diagnosis.mjs";
import {
  summarizeLocalMvpResult,
  summarizeSelfTestResult,
} from "./ios_nemotron_structured_smoke_summary.mjs";
import { forbiddenTextFields, textPrivacyIssuesForJsonLines } from "./text_privacy_fields.mjs";
export function loadSmokeEvidence(smokeLog, maxAgeHours, nowMs = Date.now()) {
  if (!existsSync(smokeLog)) {
    return {
      path: smokeLog,
      exists: false,
      fresh: false,
      freshness: "missing",
      modifiedAt: null,
      ageHours: null,
      maxAgeHours,
      markers: smokeMarkers(""),
      results: smokeStructuredResults(""),
      issues: ["smoke log file is missing"],
    };
  }
  const content = readFileSync(smokeLog, "utf8");
  const markers = smokeMarkers(content);
  const results = smokeStructuredResults(content);
  const privacy = smokeLogPrivacy(content);
  return {
    path: smokeLog,
    exists: true,
    ...fileFreshness(smokeLog, maxAgeHours, nowMs),
    markers,
    results,
    privacyOk: privacy.ok,
    privacyIssue: privacy.issue,
    issues: [
      ...smokeLogIssues(content),
      ...smokeLogPrivacyIssues(privacy),
      ...missingSmokeMarkerIssues(markers),
      ...smokeStructuredResultIssues(results),
    ],
  };
}
export function loadPreflightEvidence(preflightJson, maxAgeHours, nowMs = Date.now()) {
  if (!existsSync(preflightJson)) {
    return { path: preflightJson, exists: false, pass: false };
  }
  const payload = parseJson(readFileSync(preflightJson, "utf8"));
  const generatedMs = Date.parse(payload?.generatedAt ?? "");
  const ageHours = Number.isFinite(generatedMs)
    ? (nowMs - generatedMs) / 36e5
    : null;
  const fresh = ageHours !== null &&
    ageHours >= 0 &&
    ageHours <= maxAgeHours;
  const statusPass = payload?.status === "pass";
  return {
    path: preflightJson,
    exists: true,
    pass: statusPass && fresh,
    status: payload?.status ?? "invalid",
    generatedAt: payload?.generatedAt ?? null,
    freshness: fresh ? "fresh" : statusPass ? "stale" : "not_pass",
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    maxAgeHours,
    simulatorApp: payload?.simulatorApp ?? null,
    deviceApp: payload?.deviceApp ?? null,
    signedDeviceBuildRequested: payload?.signedDeviceBuildRequested ?? false,
    signedBuildJson: payload?.signedBuildJson ?? null,
  };
}
export function loadSignedBuildEvidence(
  signedBuildJson,
  maxAgeHours,
  nowMs = Date.now(),
) {
  if (!existsSync(signedBuildJson)) {
    return {
      path: signedBuildJson,
      exists: false,
      pass: false,
      status: "missing",
      issues: ["signed build evidence file is missing"],
      actions: ["Run `IOS_NEMOTRON_PREFLIGHT_SIGNED_BUILD=true npm run ios:nemotron:preflight` after the iPhone is ready."],
    };
  }
  const payload = parseJson(readFileSync(signedBuildJson, "utf8"));
  const generatedMs = Date.parse(payload?.generatedAt ?? "");
  const ageHours = Number.isFinite(generatedMs)
    ? (nowMs - generatedMs) / 36e5
    : null;
  const fresh = ageHours !== null &&
    ageHours >= 0 &&
    ageHours <= maxAgeHours;
  const logContent = payload?.logPath && existsSync(payload.logPath)
    ? readFileSync(payload.logPath, "utf8")
    : "";
  const diagnosis = signedBuildDiagnosis(logContent);
  const statusPass = payload?.status === "pass";
  return {
    ...payload,
    path: signedBuildJson,
    exists: true,
    pass: statusPass && fresh,
    freshness: fresh ? "fresh" : statusPass ? "stale" : "not_pass",
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    maxAgeHours,
    issues: payload?.issues ?? diagnosis.issues,
    actions: payload?.actions ?? diagnosis.actions,
  };
}
export function loadGatewayEvidence(gatewayLog, maxAgeHours, nowMs = Date.now()) {
  if (!existsSync(gatewayLog)) {
    return {
      path: gatewayLog,
      exists: false,
      fresh: false,
      freshness: "missing",
      modifiedAt: null,
      ageHours: null,
      maxAgeHours,
      textSegmentLogFound: false,
      privacyOk: false,
      privacyIssue: "Gateway log file is missing.",
      issues: ["Gateway log file is missing."],
    };
  }
  const content = readFileSync(gatewayLog, "utf8");
  const evidence = gatewayLogEvidence(gatewayLog, content);
  return {
    ...fileFreshness(gatewayLog, maxAgeHours, nowMs),
    ...evidence,
    issues: gatewayLogIssues(content, evidence),
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
function gatewayLogEvidence(gatewayLog, content) {
  const lines = content.split(/\r?\n/).filter((line) => {
    return line.includes("Client text segment received");
  });
  const privacyIssues = [];
  for (const line of lines) {
    const parsed = parseJson(line);
    if (!parsed) {
      privacyIssues.push("text segment log line is not JSON");
      continue;
    }
    for (const field of forbiddenTextFields(parsed)) {
      privacyIssues.push(`forbidden field ${field}`);
    }
  }
  return {
    path: gatewayLog,
    exists: true,
    textSegmentLogFound: lines.length > 0,
    privacyOk: lines.length > 0 && privacyIssues.length === 0,
    privacyIssue: privacyIssues.join("; "),
  };
}
function smokeMarkers(content) {
  const definitions = [
    ["COREML_NEMOTRON_PREPARE_OK", "diagnostics prepare"],
    ["COREML_NEMOTRON_SELF_TEST_SEGMENT", "microphone ASR segment"],
    ["COREML_NEMOTRON_LOCAL_MVP_RESULT", "local MVP structured result"],
    ["COREML_NEMOTRON_LOCAL_MVP_HISTORY", "local MVP history saved"],
  ];
  return definitions.map(([marker, label]) => ({
    marker,
    label,
    found: content.includes(marker),
  }));
}
function smokeStructuredResults(content) {
  return [
    {
      label: "Microphone self-test result",
      marker: "COREML_NEMOTRON_SELF_TEST_RESULT",
      summary: summarizeSelfTestResult(
        lastJsonPayload(content, "COREML_NEMOTRON_SELF_TEST_RESULT"),
      ),
    },
    {
      label: "Local on-device MVP result",
      marker: "COREML_NEMOTRON_LOCAL_MVP_RESULT",
      summary: summarizeLocalMvpResult(
        lastJsonPayload(content, "COREML_NEMOTRON_LOCAL_MVP_RESULT"),
      ),
    },
  ].map((result) => ({
    ...result,
    found: result.summary !== null,
  }));
}
function smokeLogPrivacy(content) {
  const issues = textPrivacyIssuesForJsonLines(content, /COREML_NEMOTRON_(SELF_TEST_(SEGMENT|RESULT)|LOCAL_MVP_(RESULT|HISTORY)|GATEWAY_E2E_(ASR_SENT|EVENT|RESULT|HISTORY))/);
  return { ok: issues.length === 0, issue: issues.join("; ") };
}
function lastJsonPayload(content, marker) {
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const markerIndex = line.indexOf(marker);
    if (markerIndex === -1) continue;
    const jsonStart = line.indexOf("{", markerIndex + marker.length);
    if (jsonStart === -1) return null;
    return parseJson(line.slice(jsonStart));
  }
  return null;
}

function smokeLogIssues(content) {
  const errorMarkerPattern = /COREML_NEMOTRON_(SELF_TEST_ERROR|SELF_TEST_STOP_ERROR|LOCAL_MVP_ERROR|LOCAL_MVP_STOP_ERROR|LOCAL_MVP_HISTORY_ERROR|GATEWAY_E2E_ERROR|GATEWAY_E2E_STOP_ERROR|GATEWAY_E2E_END_ERROR|GATEWAY_E2E_HISTORY_ERROR|GATEWAY_E2E_AUDIO_ERROR)/;
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line === "No tests ran." ||
      line.includes("Command timed out after") ||
      errorMarkerPattern.test(line)
    )
    .slice(-10);
}

function missingSmokeMarkerIssues(markers) {
  return markers
    .filter((marker) => !marker.found)
    .map((marker) => `required smoke marker is missing: ${marker.marker}`);
}

function gatewayLogIssues(content, evidence) {
  const issues = content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('"level":50') || line.includes('"level":60'))
    .slice(-10);
  if (!evidence.textSegmentLogFound) {
    issues.push("Gateway text segment log marker is missing.");
  } else if (!evidence.privacyOk) {
    issues.push(`Gateway text segment privacy issue: ${evidence.privacyIssue}`);
  }
  return issues;
}

function smokeLogPrivacyIssues(privacy) {
  return privacy.ok ? [] : [`Smoke log text privacy issue: ${privacy.issue}`];
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
