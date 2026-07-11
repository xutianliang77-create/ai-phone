import {
  effectiveDeferredEvidenceActions,
  effectiveDeferredEvidenceIssues,
  effectiveDeferredEvidenceStatus,
  effectiveWaitDeviceIssuesForMarkdown,
} from "./ios_nemotron_report_deferred_evidence.mjs";

export function buildAcceptanceMarkdown(input) {
  const status = input.status;
  const runtimeContract = input.requiredRuntimeContract ?? {};
  const gateRows = status.checks.map((check) => {
    return `| ${check.name} | ${check.status.toUpperCase()} | ${escapeCell(check.message)} |`;
  }).join("\n");
  const smokeRows = input.smokeEvidence.markers.map((item) => {
    return `| ${item.label} | ${item.marker} | ${item.found ? "FOUND" : "MISSING"} |`;
  }).join("\n");
  const gatewayRows = input.gatewayRows.map((item) => {
    return `| ${item.label} | ${escapeCell(item.marker)} | ${item.found ? "FOUND" : "MISSING"} |`;
  }).join("\n");
  const resultRows = (input.smokeEvidence.results ?? []).map((item) => {
    return `| ${item.label} | ${item.marker} | ${item.found ? "FOUND" : "MISSING"} | ${escapeCell(summaryText(item.summary))} |`;
  }).join("\n");
  const readinessSection = physicalReadinessSection(status);
  const waitDeviceSectionText = waitDeviceSection(
    input.waitDeviceEvidence,
    input.statusEvidence,
    status,
  );
  const repairIssueLines = logIssueLines(
    effectiveDeferredEvidenceIssues(
      "ios_provisioning_profile",
      input.provisioningRepairEvidence.issues,
      input.statusEvidence,
      status,
    ),
  );
  const repairActionLines = logIssueLines(
    effectiveDeferredEvidenceActions(
      input.provisioningRepairEvidence.actions,
      input.statusEvidence,
      status,
    ),
  );
  const signedBuildIssueLines = logIssueLines(
    effectiveDeferredEvidenceIssues(
      "ios_signed_device_build",
      input.signedBuildEvidence.issues,
      input.statusEvidence,
      status,
    ),
  );
  const signedBuildActionLines = logIssueLines(
    effectiveDeferredEvidenceActions(
      input.signedBuildEvidence.actions,
      input.statusEvidence,
      status,
    ),
  );
  const lmStudioIssueLines = logIssueLines(input.lmStudioProviderEvidence.issues);
  const lmStudioActionLines = logIssueLines(input.lmStudioProviderEvidence.actions);
  const smokeIssueLines = logIssueLines(input.smokeEvidence.issues);
  const gatewayIssueLines = logIssueLines(input.gatewayEvidence.issues);

  return `# iOS Nemotron MVP Acceptance Report

Generated at: ${input.generatedAt}

## Summary

- Overall: ${input.ready ? "PASS" : "NOT READY"}
- Device: ${status.deviceId ?? "not set"}
- Simulator app: ${status.simulatorBuiltApp ?? status.builtApp}
- iPhoneOS app: ${status.deviceBuiltApp ?? "not recorded"}
- Status source: ${input.statusEvidence.saved ? input.statusEvidence.source : "live check"}
- Status generated at: ${input.statusEvidence.generatedAt ?? "missing"}
- Status freshness: ${input.statusEvidence.fresh ? "fresh" : "stale"} (age ${input.statusEvidence.ageHours ?? "unknown"}h / max ${input.statusEvidence.maxAgeHours}h)
- JSON summary: ${input.jsonOutput}
- Preflight source: ${input.preflightEvidence.path}
- Preflight status: ${input.preflightEvidence.pass ? "PASS" : "NOT READY"}
- Provisioning repair source: ${input.provisioningRepairEvidence.path}
- Provisioning repair status: ${input.provisioningRepairEvidence.pass ? "PASS" : "NOT READY"}
- Signed build source: ${input.signedBuildEvidence.path}
- Signed build status: ${input.signedBuildEvidence.pass ? "PASS" : "NOT READY"}
- LM Studio provider source: ${input.lmStudioProviderEvidence.path}
- LM Studio provider required: ${input.lmStudioProviderEvidence.required === false ? "no" : "yes"}
- LM Studio provider status: ${input.lmStudioProviderEvidence.pass ? "PASS" : "NOT READY"}
- Wait-device readiness source: ${input.waitDeviceEvidence.readinessPath}
- Wait-device log source: ${input.waitDeviceEvidence.logPath}
- Completion claim: ${input.ready
    ? "All gates and required final smoke markers passed."
    : "Not complete. Gates or final smoke evidence are still missing."}

## Gates

| Gate | Status | Evidence |
| --- | --- | --- |
${gateRows}
${readinessSection}
${waitDeviceSectionText}

## Local Preflight

- Exists: ${input.preflightEvidence.exists ? "yes" : "no"}
- Status: ${input.preflightEvidence.status ?? "missing"}
- Generated at: ${input.preflightEvidence.generatedAt ?? "missing"}
- Freshness: ${input.preflightEvidence.freshness ?? "missing"} (age ${input.preflightEvidence.ageHours ?? "unknown"}h / max ${input.preflightEvidence.maxAgeHours ?? input.maxPreflightAgeHours}h)
- Simulator app: ${input.preflightEvidence.simulatorApp ?? "missing"}
- iPhoneOS app: ${input.preflightEvidence.deviceApp ?? "missing"}
- Signed build requested: ${input.preflightEvidence.signedDeviceBuildRequested ? "yes" : "no"}
- Signed build JSON: ${input.preflightEvidence.signedBuildJson ?? "missing"}

## Provisioning Repair

- Exists: ${input.provisioningRepairEvidence.exists ? "yes" : "no"}
- Status: ${effectiveDeferredEvidenceStatus(input.provisioningRepairEvidence.status, input.statusEvidence, status)}
- Stage: ${input.provisioningRepairEvidence.stage ?? "missing"}
- Generated at: ${input.provisioningRepairEvidence.generatedAt ?? "missing"}
- Freshness: ${input.provisioningRepairEvidence.freshness ?? "missing"} (age ${input.provisioningRepairEvidence.ageHours ?? "unknown"}h / max ${input.provisioningRepairEvidence.maxAgeHours ?? input.maxProvisioningRepairAgeHours}h)
- Log: ${input.provisioningRepairEvidence.logPath ?? "missing"}
- Profile before: ${profileSummary(input.provisioningRepairEvidence.profileBefore)}
- Profile after: ${profileSummary(input.provisioningRepairEvidence.profileAfter)}
- Issues: ${repairIssueLines.length > 0 ? "" : "none"}
${repairIssueLines.join("\n")}
- Actions: ${repairActionLines.length > 0 ? "" : "none"}
${repairActionLines.join("\n")}

## Signed Device Build

- Exists: ${input.signedBuildEvidence.exists ? "yes" : "no"}
- Status: ${effectiveDeferredEvidenceStatus(input.signedBuildEvidence.status, input.statusEvidence, status)}
- Generated at: ${input.signedBuildEvidence.generatedAt ?? "missing"}
- Freshness: ${input.signedBuildEvidence.freshness ?? "missing"} (age ${input.signedBuildEvidence.ageHours ?? "unknown"}h / max ${input.signedBuildEvidence.maxAgeHours ?? input.maxSignedBuildAgeHours}h)
- Command: ${input.signedBuildEvidence.command ?? "missing"}
- Log: ${input.signedBuildEvidence.logPath ?? "missing"}
- Issues: ${signedBuildIssueLines.length > 0 ? "" : "none"}
${signedBuildIssueLines.join("\n")}
- Actions: ${signedBuildActionLines.length > 0 ? "" : "none"}
${signedBuildActionLines.join("\n")}

## LM Studio Translation Provider

- Exists: ${input.lmStudioProviderEvidence.exists ? "yes" : "no"}
- Required: ${input.lmStudioProviderEvidence.required === false ? "no" : "yes"}
- Status: ${input.lmStudioProviderEvidence.status ?? "missing"}
- Freshness: ${input.lmStudioProviderEvidence.freshness ?? "missing"} (modified ${input.lmStudioProviderEvidence.modifiedAt ?? "missing"}, age ${input.lmStudioProviderEvidence.ageHours ?? "unknown"}h / max ${input.lmStudioProviderEvidence.maxAgeHours ?? input.maxLmStudioProviderAgeHours}h)
- Base URL: ${input.lmStudioProviderEvidence.baseUrl ?? "missing"}
- Model: ${input.lmStudioProviderEvidence.model ?? "missing"}
- Model listed: ${input.lmStudioProviderEvidence.modelListed === true ? "yes" : "no"}
- Latency: ${input.lmStudioProviderEvidence.latencyMs ?? "unknown"}ms
- Reasoning tokens: ${input.lmStudioProviderEvidence.reasoningTokens ?? "unknown"}
- Translation non-empty: ${input.lmStudioProviderEvidence.translation ? "yes" : "no"} (${translationLength(input.lmStudioProviderEvidence.translation)} chars)
- Issues: ${lmStudioIssueLines.length > 0 ? "" : "none"}
${lmStudioIssueLines.join("\n")}
- Actions: ${lmStudioActionLines.length > 0 ? "" : "none"}
${lmStudioActionLines.join("\n")}

## Required Final Smoke

Run this only after all gates pass:

\`\`\`bash
DEVICE_ID="Wha的iPhone" npm run ios:nemotron:run
\`\`\`

Expected final evidence:

- diagnostics emits \`COREML_NEMOTRON_PREPARE_OK\`
- microphone selftest emits \`COREML_NEMOTRON_SELF_TEST_SEGMENT\`
- structured results prove \`deviceAsrProvider=${contractValue(runtimeContract.deviceAsrProvider)}\`, \`sourceLanguage=${contractValue(runtimeContract.sourceLanguage)}\`, \`targetLanguage=${contractValue(runtimeContract.targetLanguage)}\`, \`modelChunkMs=${contractValue(runtimeContract.modelChunkMs)}\`, and \`autoDownloadModel=${contractValue(runtimeContract.autoDownloadModel)}\`
- local MVP emits \`COREML_NEMOTRON_LOCAL_MVP_RESULT\` with \`translationAvailable=true\` and \`translationFinal=true\`
- local history emits \`COREML_NEMOTRON_LOCAL_MVP_HISTORY\` with saved segments
- local Markdown export reports \`localExportReady=true\`

## Final Smoke Evidence

- Smoke log: ${input.smokeEvidence.path}
- Smoke log exists: ${input.smokeEvidence.exists ? "yes" : "no"}
- Smoke log freshness: ${input.smokeEvidence.freshness ?? "missing"} (modified ${input.smokeEvidence.modifiedAt ?? "missing"}, age ${input.smokeEvidence.ageHours ?? "unknown"}h / max ${input.smokeEvidence.maxAgeHours ?? input.maxFinalEvidenceAgeHours}h)
- Smoke log issues: ${smokeIssueLines.length > 0 ? "" : "none"}
${smokeIssueLines.join("\n")}
- Gateway log: ${input.gatewayEvidence.path}
- Gateway log exists: ${input.gatewayEvidence.exists ? "yes" : "no"}
- Gateway log freshness: ${input.gatewayEvidence.freshness ?? "missing"} (modified ${input.gatewayEvidence.modifiedAt ?? "missing"}, age ${input.gatewayEvidence.ageHours ?? "unknown"}h / max ${input.gatewayEvidence.maxAgeHours ?? input.maxFinalEvidenceAgeHours}h)
- Gateway log issues: ${gatewayIssueLines.length > 0 ? "" : "none"}
${gatewayIssueLines.join("\n")}

| Evidence | Marker | Status |
| --- | --- | --- |
${smokeRows}
${gatewayRows}

## Structured Smoke Results

| Result | Marker | Status | Summary |
| --- | --- | --- | --- |
${resultRows || "| none | none | MISSING | no structured smoke result found |"}

## Next Actions

${input.nextActions}
`;
}

function summaryText(summary) {
  if (!summary) return "missing";
  return Object.entries(summary)
    .map(([key, value]) => `${key}=${formatSummaryValue(value)}`)
    .join("; ");
}

function formatSummaryValue(value) {
  if (Array.isArray(value)) return `[${value.join(",")}]`;
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function logIssueLines(issues) {
  return (issues ?? []).map((issue) => `  - ${issue}`);
}

function profileSummary(profile) {
  if (!profile) return "missing";
  return [
    `status=${profile.status ?? "unknown"}`,
    `profileCount=${profile.profileCount ?? "unknown"}`,
    `candidateCount=${profile.candidateCount ?? "unknown"}`,
  ].join("; ");
}

function translationLength(value) {
  return typeof value === "string" ? value.length : 0;
}

function contractValue(value) {
  return value === undefined ? "missing" : String(value);
}

function physicalReadinessSection(status) {
  const gate = status.checks.find((check) =>
    check.name === "physical_iphone_readiness"
  );
  const details = gate?.details;
  if (!details) return "";
  const deviceRows = (details.devices ?? []).map((device) => {
    return [
      escapeCell(device.name ?? "unknown"),
      escapeCell(device.model ?? "unknown"),
      escapeCell(device.osVersion ?? "unknown"),
      escapeCell(device.pairingState ?? "unknown"),
      escapeCell(device.developerModeStatus ?? "unknown"),
      escapeCell(device.tunnelState ?? "unknown"),
      escapeCell(device.lastConnectionDate ?? "unknown"),
      device.ready ? "yes" : "no",
    ].join(" | ");
  }).map((row) => `| ${row} |`).join("\n");
  const actions = (details.devices ?? [])
    .flatMap((device) => (device.actions ?? []).map((action) => {
      const name = device.name ?? "unknown";
      return `- ${name}: ${action}`;
    }));

  return `

## Physical iPhone Readiness

- Ready: ${details.ready ? "yes" : "no"}
- Requested device: ${details.requestedDevice ?? "not set"}
- Physical devices: ${details.physicalDeviceCount ?? "unknown"}
- Matched devices: ${details.matchedDeviceCount ?? "unknown"}

| Device | Model | iOS | Pairing | Developer Mode | Tunnel | Last Connection | Ready |
| --- | --- | --- | --- | --- | --- | --- | --- |
${deviceRows || "| missing | missing | missing | missing | missing | missing | missing | no |"}

${actions.length > 0 ? actions.join("\n") : "- No remediation actions reported."}
`;
}

function waitDeviceSection(evidence, statusEvidence, status) {
  const deviceRows = (evidence.devices ?? []).map((device) => {
    return [
      escapeCell(device.name),
      escapeCell(device.model),
      escapeCell(device.osVersion),
      escapeCell(device.pairingState),
      escapeCell(device.developerModeStatus),
      escapeCell(device.tunnelState),
      device.ready ? "yes" : "no",
    ].join(" | ");
  }).map((row) => `| ${row} |`).join("\n");
  const issueLines = logIssueLines(
    effectiveWaitDeviceIssuesForMarkdown(evidence, statusEvidence, status),
  );
  const actionLines = logIssueLines(evidence.actions);

  return `

## Wait Device Evidence

- Ready: ${evidence.ready ? "yes" : "no"}
- Requested device: ${evidence.requestedDevice ?? "not set"}
- Physical devices: ${evidence.physicalDeviceCount ?? "unknown"}
- Matched devices: ${evidence.matchedDeviceCount ?? "unknown"}
- Readiness JSON exists: ${evidence.readiness.exists ? "yes" : "no"}
- Readiness JSON freshness: ${evidence.readiness.freshness ?? "missing"} (modified ${evidence.readiness.modifiedAt ?? "missing"}, age ${evidence.readiness.ageHours ?? "unknown"}h / max ${evidence.readiness.maxAgeHours}h)
- Wait log exists: ${evidence.log.exists ? "yes" : "no"}
- Wait log freshness: ${evidence.log.freshness ?? "missing"} (modified ${evidence.log.modifiedAt ?? "missing"}, age ${evidence.log.ageHours ?? "unknown"}h / max ${evidence.log.maxAgeHours}h)
- Wait log attempted: ${evidence.log.attempted ? "yes" : "no"}
- Report refreshed on exit: ${evidence.log.reportRefreshed ? "yes" : "no"}
- Issues: ${issueLines.length > 0 ? "" : "none"}
${issueLines.join("\n")}
- Actions: ${actionLines.length > 0 ? "" : "none"}
${actionLines.join("\n")}

| Device | Model | iOS | Pairing | Developer Mode | Tunnel | Ready |
| --- | --- | --- | --- | --- | --- | --- |
${deviceRows || "| missing | missing | missing | missing | missing | missing | no |"}
`;
}

function escapeCell(value) {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}
