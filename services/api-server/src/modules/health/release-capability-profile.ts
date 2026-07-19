export type DomesticReleaseCapabilityProfile =
  | "core_translation"
  | "commercial_full";

const deferredCapabilities = ["livekit_sip", "agent", "egress"] as const;

export function getReleaseCapabilityProfileReadiness() {
  const configured = process.env.DOMESTIC_RELEASE_CAPABILITY_PROFILE?.trim();
  const profile = configured || "core_translation";
  const issues = validProfile(profile)
    ? profileIssues(profile)
    : [`invalid DOMESTIC_RELEASE_CAPABILITY_PROFILE ${profile}`];
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    profile,
    explicit: Boolean(configured),
    deferredCapabilities:
      profile === "core_translation" ? [...deferredCapabilities] : [],
    issues,
  };
}

function profileIssues(profile: DomesticReleaseCapabilityProfile) {
  if (profile === "core_translation") {
    return [
      ...fixedValueIssue("CALL_PROVIDER_POLICY", "call_link_only"),
      ...disabledFlagIssue("AGENT_CALL_WORKER_ENABLED"),
      ...disabledFlagIssue("VOICE_AGENT_ENABLED"),
      ...disabledFlagIssue("VOICE_AGENT_ASSIST_ENABLED"),
      ...disabledFlagIssue("VOICE_AGENT_AUTONOMOUS_ENABLED"),
      ...disabledFlagIssue("VOICE_AGENT_OPERATOR_CONSULT_ENABLED"),
      ...disabledFlagIssue("LIVEKIT_EGRESS_ENABLED"),
      ...disabledFlagIssue("LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED"),
    ];
  }
  return [
    ...oneOfIssue("CALL_PROVIDER_POLICY", [
      "domestic_pstn_bridge",
      "pstn_enabled",
    ]),
    ...enabledFlagIssue("AGENT_CALL_WORKER_ENABLED"),
    ...enabledFlagIssue("VOICE_AGENT_ENABLED"),
    ...enabledFlagIssue("VOICE_AGENT_ASSIST_ENABLED"),
    ...enabledFlagIssue("LIVEKIT_EGRESS_ENABLED"),
    ...enabledFlagIssue("LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED"),
  ];
}

function validProfile(
  value: string,
): value is DomesticReleaseCapabilityProfile {
  return value === "core_translation" || value === "commercial_full";
}

function fixedValueIssue(name: string, expected: string) {
  const actual = process.env[name] ?? (name === "CALL_PROVIDER_POLICY"
    ? "call_link_only"
    : "");
  return actual === expected
    ? []
    : [`${name} must be ${expected} for core_translation`];
}

function oneOfIssue(name: string, allowed: string[]) {
  return allowed.includes(process.env[name] ?? "")
    ? []
    : [`${name} must enable PSTN for commercial_full`];
}

function disabledFlagIssue(name: string) {
  return process.env[name] === "true"
    ? [`${name} must be false for core_translation`]
    : [];
}

function enabledFlagIssue(name: string) {
  return process.env[name] === "true"
    ? []
    : [`${name} must be true for commercial_full`];
}
