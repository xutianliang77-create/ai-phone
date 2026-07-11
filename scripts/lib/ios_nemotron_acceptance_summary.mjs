import {
  currentPhysicalReadinessAvailable,
  currentPhysicalReadinessNotReady,
  physicalReadinessActions,
} from "./ios_nemotron_report_deferred_evidence.mjs";

export function buildAcceptanceSummary(input) {
  const status = input.statusEvidence.payload;
  const waitDeviceIssues = currentPhysicalReadinessAvailable(
    input.statusEvidence,
    status,
  )
    ? []
    : input.waitDeviceEvidence.issues ?? [];
  const physicalBlocked = currentPhysicalReadinessNotReady(
    input.statusEvidence,
    status,
  );
  const readinessActions = physicalReadinessActions(status);
  return {
    schemaVersion: 11,
    generatedAt: input.generatedAt,
    overall: input.ready ? "pass" : "not_ready",
    ready: input.ready,
    deviceId: status.deviceId ?? null,
    requiredRuntimeContract: input.requiredRuntimeContract ?? null,
    sources: {
      markdownReport: input.markdownOutput,
      status: input.statusEvidence.source,
      preflight: input.preflightEvidence.path,
      provisioningRepair: input.provisioningRepairEvidence.path,
      signedBuild: input.signedBuildEvidence.path,
      lmStudioProvider: input.lmStudioProviderEvidence.path,
      smokeLog: input.smokeEvidence.path,
      gatewayLog: input.gatewayEvidence.path,
      waitDeviceReadiness: input.waitDeviceEvidence.readinessPath,
      waitDeviceLog: input.waitDeviceEvidence.logPath,
    },
    freshness: {
      status: {
        fresh: input.statusEvidence.fresh,
        generatedAt: input.statusEvidence.generatedAt,
        ageHours: input.statusEvidence.ageHours,
        maxAgeHours: input.statusEvidence.maxAgeHours,
      },
      preflight: {
        pass: input.preflightEvidence.pass,
        status: input.preflightEvidence.status ?? "missing",
        freshness: input.preflightEvidence.freshness ?? "missing",
        generatedAt: input.preflightEvidence.generatedAt ?? null,
        ageHours: input.preflightEvidence.ageHours ?? null,
        maxAgeHours: input.preflightEvidence.maxAgeHours ?? null,
      },
      provisioningRepair: {
        pass: input.provisioningRepairEvidence.pass,
        status: input.provisioningRepairEvidence.status ?? "missing",
        stage: input.provisioningRepairEvidence.stage ?? "missing",
        freshness: input.provisioningRepairEvidence.freshness ?? "missing",
        generatedAt: input.provisioningRepairEvidence.generatedAt ?? null,
        ageHours: input.provisioningRepairEvidence.ageHours ?? null,
        maxAgeHours: input.provisioningRepairEvidence.maxAgeHours ?? null,
      },
      signedBuild: {
        pass: input.signedBuildEvidence.pass,
        status: input.signedBuildEvidence.status ?? "missing",
        freshness: input.signedBuildEvidence.freshness ?? "missing",
        generatedAt: input.signedBuildEvidence.generatedAt ?? null,
        ageHours: input.signedBuildEvidence.ageHours ?? null,
        maxAgeHours: input.signedBuildEvidence.maxAgeHours ?? null,
      },
      lmStudioProvider: {
        required: input.lmStudioProviderEvidence.required ?? true,
        pass: input.lmStudioProviderEvidence.pass,
        status: input.lmStudioProviderEvidence.status ?? "missing",
        freshness: input.lmStudioProviderEvidence.freshness ?? "missing",
        modifiedAt: input.lmStudioProviderEvidence.modifiedAt ?? null,
        ageHours: input.lmStudioProviderEvidence.ageHours ?? null,
        maxAgeHours: input.lmStudioProviderEvidence.maxAgeHours ?? null,
      },
      smokeLog: logFreshness(input.smokeEvidence),
      gatewayLog: logFreshness(input.gatewayEvidence),
      waitDevice: {
        readiness: logFreshness(input.waitDeviceEvidence.readiness),
        log: logFreshness(input.waitDeviceEvidence.log),
        ready: input.waitDeviceEvidence.ready,
        requestedDevice: input.waitDeviceEvidence.requestedDevice,
        physicalDeviceCount: input.waitDeviceEvidence.physicalDeviceCount,
        matchedDeviceCount: input.waitDeviceEvidence.matchedDeviceCount,
      },
    },
    gates: status.checks.map(summaryGate),
    smokeMarkers: input.smokeEvidence.markers.map(summaryMarker),
    smokeResults: (input.smokeEvidence.results ?? []).map(summaryResult),
    gatewayEvidence: input.gatewayRows.map(summaryMarker),
    evidenceIssues: {
      provisioningRepair: physicalBlocked
        ? []
        : input.provisioningRepairEvidence.issues ?? [],
      signedBuild: physicalBlocked ? [] : input.signedBuildEvidence.issues ?? [],
      lmStudioProvider: input.lmStudioProviderEvidence.issues ?? [],
      smokeLog: input.smokeEvidence.issues ?? [],
      gatewayLog: input.gatewayEvidence.issues ?? [],
      waitDevice: waitDeviceIssues,
    },
    evidenceActions: {
      provisioningRepair: physicalBlocked
        ? readinessActions
        : input.provisioningRepairEvidence.actions ?? [],
      signedBuild: physicalBlocked
        ? readinessActions
        : input.signedBuildEvidence.actions ?? [],
      lmStudioProvider: input.lmStudioProviderEvidence.actions ?? [],
      waitDevice: input.waitDeviceEvidence.actions ?? [],
    },
    waitDevice: {
      ready: input.waitDeviceEvidence.ready,
      requestedDevice: input.waitDeviceEvidence.requestedDevice,
      devices: input.waitDeviceEvidence.devices,
    },
    lmStudioProvider: {
      required: input.lmStudioProviderEvidence.required ?? true,
      status: input.lmStudioProviderEvidence.status ?? "missing",
      model: input.lmStudioProviderEvidence.model ?? null,
      modelListed: input.lmStudioProviderEvidence.modelListed ?? null,
      latencyMs: input.lmStudioProviderEvidence.latencyMs ?? null,
      reasoningTokens: input.lmStudioProviderEvidence.reasoningTokens ?? null,
    },
    failedGates: input.failedGates.map((check) => ({
      name: check.name,
      message: check.message,
    })),
    pendingGates: input.pendingGates.map((check) => ({
      name: check.name,
      message: check.message,
    })),
    missingSmokeMarkers: input.missingSmoke.map((item) => item.marker),
    missingGatewayEvidence: input.missingGateway.map((item) => item.label),
    nextActions: input.nextActions
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean),
  };
}

function summaryResult(item) {
  return {
    label: item.label,
    marker: item.marker,
    found: item.found,
    summary: item.summary,
  };
}

function summaryGate(check) {
  return {
    name: check.name,
    status: check.status,
    message: check.message,
    ...(check.details === undefined ? {} : { details: check.details }),
  };
}

function summaryMarker(item) {
  return {
    label: item.label,
    marker: item.marker,
    found: item.found,
  };
}

function logFreshness(evidence) {
  return {
    fresh: evidence.fresh,
    freshness: evidence.freshness ?? "missing",
    modifiedAt: evidence.modifiedAt ?? null,
    ageHours: evidence.ageHours ?? null,
    maxAgeHours: evidence.maxAgeHours ?? null,
  };
}
