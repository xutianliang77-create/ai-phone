export function effectiveWaitDeviceIssuesForMarkdown(
  evidence,
  statusEvidence,
  status,
) {
  if (currentPhysicalReadinessAvailable(statusEvidence, status)) return [];
  return evidence.issues ?? [];
}

export function effectiveDeferredEvidenceIssues(
  pendingGateName,
  issues,
  statusEvidence,
  status,
) {
  if (!currentPhysicalReadinessNotReady(statusEvidence, status)) {
    return issues ?? [];
  }
  const pendingGate = (status?.checks ?? []).find((check) => {
    return check.name === pendingGateName && check.status === "pending";
  });
  return pendingGate ? [pendingGate.message] : [];
}

export function effectiveDeferredEvidenceActions(
  actions,
  statusEvidence,
  status,
) {
  if (!currentPhysicalReadinessNotReady(statusEvidence, status)) {
    return actions ?? [];
  }
  return physicalReadinessActions(status);
}

export function effectiveDeferredEvidenceStatus(
  evidenceStatus,
  statusEvidence,
  status,
) {
  if (!currentPhysicalReadinessNotReady(statusEvidence, status)) {
    return evidenceStatus ?? "missing";
  }
  return "waiting_on_physical_iphone";
}

export function currentPhysicalReadinessAvailable(statusEvidence, status) {
  if (statusEvidence?.fresh !== true) return false;
  return (status?.checks ?? []).some((check) => {
    return check.name === "physical_iphone_readiness" && check.details;
  });
}

export function currentPhysicalReadinessNotReady(statusEvidence, status) {
  if (!currentPhysicalReadinessAvailable(statusEvidence, status)) return false;
  return (status?.checks ?? []).some((check) => {
    return check.name === "physical_iphone_readiness" && check.status !== "pass";
  });
}

export function physicalReadinessActions(status) {
  const gate = (status?.checks ?? []).find((check) =>
    check.name === "physical_iphone_readiness"
  );
  return (gate?.details?.devices ?? []).flatMap((device) => {
    const name = device.name ?? "unknown";
    return (device.actions ?? []).map((action) => `${name}: ${action}`);
  });
}
