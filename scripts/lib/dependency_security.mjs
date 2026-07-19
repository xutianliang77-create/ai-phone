export function checkDependencySecurity(input, now = new Date()) {
  const issues = [];
  const { audit, policy } = input;
  if (policy?.schemaVersion !== 1 ||
    policy?.status !== "accepted_temporary_exception") {
    issues.push("Dependency exception policy is invalid");
  }
  if (!Number.isFinite(new Date(policy?.expiresAt).getTime()) ||
    new Date(policy.expiresAt).getTime() <= now.getTime()) {
    issues.push("Dependency exception is expired or has invalid expiry");
  }
  const counts = audit?.metadata?.vulnerabilities ?? {};
  if ((counts.low ?? 0) !== 0 || (counts.high ?? 0) !== 0 ||
    (counts.critical ?? 0) !== 0) {
    issues.push("Unexpected low/high/critical dependency vulnerabilities exist");
  }
  const vulnerabilities = audit?.vulnerabilities ?? {};
  const actualNames = Object.keys(vulnerabilities).sort();
  const allowedNames = [...(policy?.allowedVulnerabilities ?? [])].sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(allowedNames) ||
    counts.moderate !== allowedNames.length) {
    issues.push("Audit vulnerability set differs from the approved OTel exception");
  }
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (vulnerability.severity !== policy.severity) {
      issues.push(`Unexpected severity for ${name}`);
    }
    if (vulnerability.isDirect && name !== policy.upstreamPackage) {
      issues.push(`Unexpected direct vulnerable package: ${name}`);
    }
  }
  const advisoryUrls = (vulnerabilities["@opentelemetry/core"]?.via ?? [])
    .flatMap((item) => typeof item === "object" ? [item.url] : []);
  if (!advisoryUrls.some((url) => url?.endsWith(policy.advisory))) {
    issues.push("Audit is not rooted in the approved OTel advisory");
  }
  for (const [name, version] of Object.entries(policy.requiredDirectVersions ?? {})) {
    if (input.apiDependencies?.[name] !== version) {
      issues.push(`API direct dependency drifted: ${name}`);
    }
  }
  if (input.agentVersions.length !== 2 ||
    input.agentVersions.some((version) => version !== policy.upstreamVersion)) {
    issues.push("LiveKit Agents version differs from the reviewed upstream version");
  }
  for (const marker of policy.requiredSourceMarkers ?? []) {
    if (!input.telemetrySource.includes(marker)) {
      issues.push(`OTel ingress mitigation is missing: ${marker}`);
    }
  }
  if (policy.reachability?.publicInboundBaggageUsed !== false ||
    policy.reachability?.livekitAgentsPropagationExtractFound !== false ||
    policy.reachability?.agentProcessesHavePublicOtelHttpInstrumentation !== false) {
    issues.push("OTel reachability assessment is incomplete");
  }
  return {
    status: issues.length === 0
      ? "accepted_with_temporary_exception" : "not_ready",
    advisory: policy?.advisory,
    expiresAt: policy?.expiresAt,
    vulnerabilityCounts: counts,
    issues,
  };
}
