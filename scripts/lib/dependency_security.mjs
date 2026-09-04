export function checkDependencySecurity(input) {
  const issues = [];
  const { audit, policy } = input;
  if (policy?.schemaVersion !== 2 ||
    policy?.status !== "enforced_zero_known_vulnerabilities") {
    issues.push("Dependency security policy is invalid");
  }
  const counts = audit?.metadata?.vulnerabilities ?? {};
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (severities.some((severity) => (counts[severity] ?? 0) !== 0)) {
    issues.push("Known production dependency vulnerabilities exist");
  }
  const vulnerabilities = audit?.vulnerabilities ?? {};
  if (Object.keys(vulnerabilities).length !== 0) {
    issues.push("Dependency audit contains vulnerability entries");
  }
  for (const [name, version] of Object.entries(policy.requiredDirectVersions ?? {})) {
    if (input.apiDependencies?.[name] !== version) {
      issues.push(`API direct dependency drifted: ${name}`);
    }
  }
  const liveKitVersions = policy.requiredLiveKitVersions ?? {};
  if (input.agentVersions.length !== 2 || input.agentVersions.some(
    (version) => version !== liveKitVersions["@livekit/agents"]
  )) {
    issues.push("LiveKit Agents version differs from the security policy");
  }
  if (input.agentPluginVersion !==
    liveKitVersions["@livekit/agents-plugin-openai"]) {
    issues.push("LiveKit OpenAI plugin version differs from the security policy");
  }
  for (const marker of policy.requiredSourceMarkers ?? []) {
    if (!input.telemetrySource.includes(marker)) {
      issues.push(`OTel ingress mitigation is missing: ${marker}`);
    }
  }
  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    policy: policy?.status,
    vulnerabilityCounts: counts,
    issues,
  };
}
