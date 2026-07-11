#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  loadGatewayEvidence,
  loadPreflightEvidence,
  loadSignedBuildEvidence,
  loadSmokeEvidence,
} from "./lib/ios_nemotron_report_evidence.mjs";
import { loadLmStudioProviderEvidence } from "./lib/lmstudio_provider_evidence.mjs";
import { loadProvisioningRepairEvidence } from "./lib/ios_nemotron_provisioning_repair_evidence.mjs";
import { loadWaitDeviceEvidence } from "./lib/ios_nemotron_wait_device_evidence.mjs";
import { nextActionText } from "./lib/ios_nemotron_next_actions.mjs";
import { buildAcceptanceSummary } from "./lib/ios_nemotron_acceptance_summary.mjs";
import { buildAcceptanceMarkdown } from "./lib/ios_nemotron_report_markdown.mjs";
import { iosNemotronRequiredRuntimeContract } from "./lib/ios_nemotron_runtime_contract.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const expectedStatusSchemaVersion = 15;
const help = takeFlag("--help") || takeFlag("-h");
const statusJsonValue = valueFlag("--status-json");
const cachedStatus = takeFlag("--cached-status");
const liveStatus = takeFlag("--live-status") || (!statusJsonValue && !cachedStatus);
const strict = takeFlag("--strict");
const maxStatusAgeHours = Number(valueFlag("--max-status-age-hours") ?? "2");
const maxPreflightAgeHours = Number(valueFlag("--max-preflight-age-hours") ?? "24");
const maxProvisioningRepairAgeHours = Number(valueFlag("--max-provisioning-repair-age-hours") ?? "24");
const maxSignedBuildAgeHours = Number(valueFlag("--max-signed-build-age-hours") ?? "24");
const maxLmStudioProviderAgeHours = Number(valueFlag("--max-lmstudio-provider-age-hours") ?? "2");
const maxFinalEvidenceAgeHours = Number(valueFlag("--max-final-evidence-age-hours") ?? "2");
const output = path.resolve(
  root,
  valueFlag("--output") ?? "docs/poc/ios-nemotron-mvp-acceptance-report.md",
);
const jsonOutput = path.resolve(
  root,
  valueFlag("--json-output") ?? ".cache/ios-nemotron-services/mvp-acceptance-summary.json",
);
const statusJson = path.resolve(
  root,
  statusJsonValue ?? ".cache/ios-nemotron-services/mvp-status.json",
);
const smokeLog = path.resolve(
  root,
  valueFlag("--smoke-log") ?? ".cache/ios-nemotron-services/mvp-smoke.log",
);
const gatewayLog = path.resolve(
  root,
  valueFlag("--gateway-log") ?? ".cache/ios-nemotron-services/realtime-gateway.log",
);
const preflightJson = path.resolve(
  root,
  valueFlag("--preflight-json") ?? ".cache/ios-nemotron-services/preflight.json",
);
const provisioningRepairJson = path.resolve(
  root,
  valueFlag("--provisioning-repair-json") ?? ".cache/ios-nemotron-services/provisioning-repair.json",
);
const signedBuildJson = path.resolve(
  root,
  valueFlag("--signed-build-json") ?? ".cache/ios-nemotron-services/signed-build.json",
);
const lmStudioProviderJson = path.resolve(
  root,
  valueFlag("--lmstudio-provider-json") ?? ".cache/ios-nemotron-services/lmstudio-provider.json",
);
const waitDeviceReadinessJson = path.resolve(
  root,
  valueFlag("--wait-device-readiness-json") ?? ".cache/ios-nemotron-services/device-readiness-latest.json",
);
const waitDeviceLog = path.resolve(
  root,
  valueFlag("--wait-device-log") ?? ".cache/ios-nemotron-services/device-readiness-wait.log",
);

if (help || args.length > 0) {
  usage();
  process.exit(help ? 0 : 1);
}

const statusEvidence = loadStatusEvidence();
const preflightEvidence = loadPreflightEvidence(preflightJson, maxPreflightAgeHours);
const provisioningRepairEvidence = loadProvisioningRepairEvidence(
  provisioningRepairJson,
  maxProvisioningRepairAgeHours,
);
const signedBuildEvidence = loadSignedBuildEvidence(
  signedBuildJson,
  maxSignedBuildAgeHours,
);
const lmStudioProviderEvidence = loadLmStudioProviderEvidence(
  lmStudioProviderJson,
  maxLmStudioProviderAgeHours,
);
const smokeEvidence = loadSmokeEvidence(smokeLog, maxFinalEvidenceAgeHours);
const gatewayEvidence = loadGatewayEvidence(gatewayLog, maxFinalEvidenceAgeHours);
const waitDeviceEvidence = loadWaitDeviceEvidence(
  waitDeviceReadinessJson,
  waitDeviceLog,
  maxFinalEvidenceAgeHours,
);
const report = buildReport(
  statusEvidence,
  preflightEvidence,
  provisioningRepairEvidence,
  signedBuildEvidence,
  lmStudioProviderEvidence,
  smokeEvidence,
  gatewayEvidence,
  waitDeviceEvidence,
);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, report.text);
mkdirSync(path.dirname(jsonOutput), { recursive: true });
writeFileSync(jsonOutput, `${JSON.stringify(report.summary, null, 2)}\n`);
console.log(`Wrote ${output}`);
console.log(`Wrote ${jsonOutput}`);
if (strict && !report.ready) process.exit(1);

function takeFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function valueFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function loadStatusEvidence() {
  if (!liveStatus && existsSync(statusJson)) {
    const content = readFileSync(statusJson, "utf8").trim();
    if (content) {
      try {
        const payload = JSON.parse(content);
        if (payload.schemaVersion === expectedStatusSchemaVersion) {
          return withStatusFreshness({ source: statusJson, saved: true, payload });
        }
      } catch {}
    }
  }
  return withStatusFreshness({ source: statusJson, saved: true, payload: loadLiveStatus() });
}

function loadLiveStatus() {
  const result = spawnSync(process.execPath, [
    path.join(root, "scripts/ios_nemotron_mvp_status.mjs"),
    "--json",
    "--status-json",
    statusJson,
  ], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0 && !result.stdout) {
    throw new Error(result.stderr || "ios_nemotron_mvp_status.mjs failed");
  }
  return JSON.parse(result.stdout);
}

function withStatusFreshness(evidence) {
  const generatedMs = Date.parse(evidence.payload?.generatedAt ?? "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Date.now() - generatedMs) / 36e5
    : null;
  return {
    ...evidence,
    generatedAt: evidence.payload?.generatedAt ?? null,
    fresh: ageHours !== null && ageHours >= 0 && ageHours <= maxStatusAgeHours,
    ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
    maxAgeHours: maxStatusAgeHours,
  };
}

function buildReport(
  statusEvidence,
  preflightEvidence,
  provisioningRepairEvidence,
  signedBuildEvidence,
  lmStudioProviderEvidence,
  smokeEvidence,
  gatewayEvidence,
  waitDeviceEvidence,
) {
  const status = statusEvidence.payload;
  const effectiveLmStudioProviderEvidence = withLmStudioRequiredStatus(
    status,
    lmStudioProviderEvidence,
  );
  const effectiveGatewayEvidence = withGatewayRequiredStatus(
    status,
    gatewayEvidence,
  );
  const generatedAt = new Date().toISOString();
  const missingSmoke = smokeEvidence.markers.filter((item) => !item.found);
  const gatewayRows = gatewayEvidenceRows(effectiveGatewayEvidence);
  const missingGateway = effectiveGatewayEvidence.required === false
    ? []
    : gatewayRows.filter((item) => !item.found);
  const ready = statusEvidence.fresh &&
    preflightEvidence.pass &&
    provisioningRepairEvidence.pass &&
    signedBuildEvidence.pass &&
    effectiveLmStudioProviderEvidence.pass &&
    smokeEvidence.fresh &&
    effectiveGatewayEvidence.fresh &&
    status.overall === "pass" &&
    smokeEvidence.issues.length === 0 &&
    effectiveGatewayEvidence.issues.length === 0 &&
    missingSmoke.length === 0 &&
    missingGateway.length === 0;
  const failed = status.checks.filter((check) => check.status === "fail");
  const pending = status.checks.filter((check) => check.status === "pending");
  const nextActions = nextActionText({
    statusEvidence,
    failedChecks: failed,
    pendingChecks: pending,
    preflightEvidence,
    provisioningRepairEvidence,
    signedBuildEvidence,
    lmStudioProviderEvidence: effectiveLmStudioProviderEvidence,
    smokeEvidence,
    gatewayEvidence: effectiveGatewayEvidence,
    missingSmoke,
    missingGateway,
  });

  return {
    ready,
    summary: buildAcceptanceSummary({
      generatedAt,
      ready,
      markdownOutput: output,
      statusEvidence,
      preflightEvidence,
      provisioningRepairEvidence,
      signedBuildEvidence,
      lmStudioProviderEvidence: effectiveLmStudioProviderEvidence,
      smokeEvidence,
      gatewayEvidence: effectiveGatewayEvidence,
      waitDeviceEvidence,
      gatewayRows,
      failedGates: failed,
      pendingGates: pending,
      missingSmoke,
      missingGateway,
      requiredRuntimeContract: iosNemotronRequiredRuntimeContract,
      nextActions,
    }),
    text: buildAcceptanceMarkdown({
      generatedAt,
      ready,
      status,
      statusEvidence,
      preflightEvidence,
      provisioningRepairEvidence,
      signedBuildEvidence,
      lmStudioProviderEvidence: effectiveLmStudioProviderEvidence,
      smokeEvidence,
      gatewayEvidence: effectiveGatewayEvidence,
      waitDeviceEvidence,
      gatewayRows,
      requiredRuntimeContract: iosNemotronRequiredRuntimeContract,
      nextActions,
      jsonOutput,
      maxPreflightAgeHours,
      maxProvisioningRepairAgeHours,
      maxSignedBuildAgeHours,
      maxLmStudioProviderAgeHours,
      maxFinalEvidenceAgeHours,
    }),
  };
}

function withGatewayRequiredStatus(status, evidence) {
  return withOptionalGateEvidence(status, evidence, "api_gateway_services", {
    fresh: true,
    issues: [],
  });
}

function withLmStudioRequiredStatus(status, evidence) {
  return withOptionalGateEvidence(status, evidence, "lmstudio_translation_provider", {
    pass: true,
    issues: [],
    actions: [],
  });
}

function withOptionalGateEvidence(status, evidence, gateName, optionalFields) {
  const gate = status.checks.find((check) => check.name === gateName);
  const required = !(
    gate?.status === "pass" &&
    String(gate.message ?? "").startsWith("not required")
  );
  if (required) return { ...evidence, required };
  return { ...evidence, required, ...optionalFields };
}

function gatewayEvidenceRows(evidence) {
  if (evidence.required === false) {
    return [{
      label: "Gateway services",
      marker: "not required for local on-device MVP",
      found: true,
    }];
  }
  return [{
    label: "Gateway text segment log",
    marker: "Client text segment received",
    found: evidence.textSegmentLogFound,
  }, {
    label: "Gateway transcript privacy",
    marker: evidence.privacyIssue ||
      "no text/transcript/sourceText/translatedText fields in text segment log payload",
    found: evidence.privacyOk,
  }];
}

function usage() {
  console.log(`Usage:
  scripts/ios_nemotron_mvp_report.mjs [options]

Common options:
  --output PATH --json-output PATH --status-json PATH --smoke-log PATH
  --preflight-json PATH --signed-build-json PATH --cached-status --strict

Generates the evidence-oriented iOS Nemotron MVP acceptance report.`);
}
