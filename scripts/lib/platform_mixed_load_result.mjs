import { REQUIRED_TRAFFIC } from "./platform_mixed_load_config.mjs";

export function summarizeMixedLoadPhase(context, results, failures, injections, system) {
  const admitted = results.filter((item) => item.attestation?.status !== "rejected");
  const rejected = results.length - admitted.length;
  const finalCount = admitted.filter((item) => item.attestation?.finalEventObserved).length;
  const metrics = admitted.map((item) => item.attestation?.metrics ?? {});
  const aggregate = {
    p95SessionStartMs: percentile(metrics.map((item) => item.sessionStartMs), 0.95),
    p95FinalLatencyMs: percentile(metrics.map((item) => item.finalLatencyMs), 0.95),
    finalCoverageRatio: admitted.length === 0 ? 0 : finalCount / admitted.length,
    errorRate: context.concurrentSessions === 0 ? 0 :
      (failures.length + results.filter((item) => item.issues.length > 0).length) /
      context.concurrentSessions,
  };
  const slo = context.config.slo;
  const validationIssueCount = results.reduce(
    (total, item) => total + item.issues.length,
    0,
  );
  const normalPassed = results.length + failures.length === context.concurrentSessions &&
    rejected === 0 && validationIssueCount === 0 &&
    aggregate.errorRate <= slo.maxErrorRate &&
    aggregate.p95SessionStartMs <= slo.p95SessionStartMs &&
    aggregate.p95FinalLatencyMs <= slo.p95FinalLatencyMs &&
    aggregate.finalCoverageRatio >= slo.minimumFinalCoverageRatio;
  const admissionPassed = context.type === "admission" &&
    Number(system?.observedUtilization) >= context.minimumObservedUtilization &&
    rejected > 0 && system?.oomCount === 0 && system?.unboundedQueueObserved === false;
  const failurePassed = injections.every((item) => item.status === "passed");
  const passed = (context.type === "admission" ? admissionPassed : normalPassed) && failurePassed;
  return {
    name: context.name,
    type: context.type,
    concurrentSessions: context.concurrentSessions,
    durationMinutes: context.durationMinutes,
    targetUtilization: context.targetUtilization,
    status: passed ? "passed" : "failed",
    sloPassed: context.type === "admission" ? admissionPassed : normalPassed,
    completedSessions: results.length,
    admittedSessions: admitted.length,
    rejectedSessions: rejected,
    realProviderTraffic: admitted.length > 0 && admitted.every((item) =>
      item.attestation?.realProviderTraffic === true),
    trafficKinds: coveredTraffic(admitted),
    metrics: aggregate,
    system,
    injections,
    failures,
    sessions: results,
  };
}

export function buildPlatformCapacityResult(input) {
  const stages = input.phases.filter((phase) => phase.type === "capacity");
  const soak = input.phases.find((phase) => phase.type === "soak");
  const admission = input.phases.find((phase) => phase.type === "admission");
  const all = input.phases.flatMap((phase) => phase.sessions);
  const admitted = all.filter((item) => item.attestation?.status !== "rejected");
  const sum = (field) => admitted.reduce(
    (total, item) => total + Number(item.attestation?.[field] ?? 0),
    0,
  );
  const finalCount = admitted.filter((item) => item.attestation?.finalEventObserved).length;
  const injections = input.phases.flatMap((phase) => phase.injections);
  const totals = {
    providerSideEffectDuplicates: sum("providerSideEffectDuplicates"),
    lostFinalEvents: sum("lostFinalEvents"),
    duplicateSettlements: sum("duplicateSettlements"),
    finalCoverageRatio: admitted.length === 0 ? 0 : finalCount / admitted.length,
  };
  const passed = input.phases.every((phase) => phase.status === "passed") &&
    REQUIRED_TRAFFIC.every((kind) => soak?.trafficKinds.includes(kind)) &&
    totals.providerSideEffectDuplicates === 0 && totals.lostFinalEvents === 0 &&
    totals.duplicateSettlements === 0 && totals.finalCoverageRatio >= 0.99;
  return {
    schemaVersion: 1,
    status: passed
      ? input.config.mode === "real" ? "passed" : "mock_passed"
      : "failed",
    environment: input.config.environment,
    runId: input.runId,
    topologySha256: input.topologySha256,
    stages: stages.map((stage) => ({
      concurrentSessions: stage.concurrentSessions,
      durationMinutes: stage.durationMinutes,
      status: stage.status,
      sloPassed: stage.sloPassed,
    })),
    soak: {
      targetUtilization: soak.targetUtilization,
      durationMinutes: soak.durationMinutes,
      realProviderTraffic: soak.realProviderTraffic,
      trafficKinds: soak.trafficKinds,
      status: soak.status,
      sloPassed: soak.sloPassed,
    },
    admission: {
      observedUtilization: admission.system?.observedUtilization ?? 0,
      rejectionObserved: admission.rejectedSessions > 0,
      oomCount: admission.system?.oomCount ?? null,
      unboundedQueueObserved: admission.system?.unboundedQueueObserved ?? null,
      status: admission.status,
    },
    failureInjection: {
      status: injections.length > 0 && injections.every((item) => item.status === "passed")
        ? "passed" : "failed",
    },
    totals,
    evidence: input.evidence,
  };
}

export function validateMixedLoadAttestation(value, context) {
  const issues = [];
  if (value?.schemaVersion !== 1) issues.push("attestation schemaVersion must be 1");
  if (!new Set(["passed", "rejected"]).has(value?.status)) {
    issues.push("attestation status must be passed or rejected");
  }
  if (value?.environment !== "staging") issues.push("attestation is not staging");
  if (value?.status === "rejected") {
    if (context.type !== "admission") issues.push("rejection occurred outside admission phase");
    if (!nonEmptyEvidence(value?.admissionEvidence)) {
      issues.push("admission rejection evidence is missing");
    }
    return issues;
  }
  if (context.config.mode === "real" && value?.realProviderTraffic !== true) {
    issues.push("real run lacks provider traffic attestation");
  }
  if (context.config.mode === "mock" && value?.realProviderTraffic !== false) {
    issues.push("mock run must not attest real provider traffic");
  }
  if (Number(value?.observedDurationMs) < context.phaseDurationMs * 0.98) {
    issues.push("session ended before the phase duration");
  }
  for (const kind of context.scenario.trafficKinds) {
    if (!value?.trafficKinds?.includes(kind)) issues.push(`missing traffic kind: ${kind}`);
    if (context.config.mode === "real" && !nonEmptyEvidence(value?.providerEvidence?.[kind])) {
      issues.push(`missing provider evidence: ${kind}`);
    }
  }
  if (value?.finalEventObserved !== true) issues.push("final event was not observed");
  for (const field of [
    "providerSideEffectDuplicates", "lostFinalEvents", "duplicateSettlements",
  ]) {
    if (!Number.isInteger(value?.[field]) || value[field] < 0) {
      issues.push(`${field} must be a non-negative integer`);
    }
  }
  if (!finiteMetric(value?.metrics?.sessionStartMs) ||
    !finiteMetric(value?.metrics?.finalLatencyMs)) {
    issues.push("session latency metrics are missing");
  }
  return issues;
}

function coveredTraffic(results) {
  return [...new Set(results.flatMap((item) => item.attestation?.trafficKinds ?? []))].sort();
}

function percentile(values, ratio) {
  const sorted = values.filter(finiteMetric).sort((left, right) => left - right);
  if (sorted.length === 0) return Infinity;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function nonEmptyEvidence(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) =>
    typeof item === "string" && item.length > 0 && item.length <= 512
  );
}

function finiteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
