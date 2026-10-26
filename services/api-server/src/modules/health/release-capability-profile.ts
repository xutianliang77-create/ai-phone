import { releaseDistribution, releaseDeferredCapabilities, isPublicReleaseEndpoint } from "@translation/platform-security";

export type DomesticReleaseCapabilityProfile =
  | "core_translation"
  | "commercial_full";

export function getReleaseCapabilityProfileReadiness() {
  const configured = process.env.DOMESTIC_RELEASE_CAPABILITY_PROFILE?.trim();
  const profile = configured || "core_translation";
  const distribution = releaseDistribution(process.env.DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL);
  const issues = validProfile(profile)
    ? profileIssues(profile)
    : [`invalid DOMESTIC_RELEASE_CAPABILITY_PROFILE ${profile}`];
  issues.push(...distribution.issues);
  if (distribution.formal) {
    if (!process.env.REALTIME_TOKEN_SECRET || process.env.REALTIME_TOKEN_SECRET.length < 32 ||
        /dev-secret|replace-with|changeme/i.test(process.env.REALTIME_TOKEN_SECRET)) issues.push("Formal release requires a strong REALTIME_TOKEN_SECRET");
    if (!configured) issues.push("App Store release requires explicit capability profile");
    if (profile !== "core_translation") issues.push("Formal 1.0 requires the approved core_translation profile");
    for (const [key, protocols] of [
      ["API_BASE_URL", ["https:"]], ["REALTIME_WS_ENDPOINT", ["wss:"]],
    ] as const) {
      if (!isPublicReleaseEndpoint(process.env[key], protocols)) issues.push(`App Store release requires public secure ${key}`);
    }
  }
  return {
    status: issues.length === 0 ? "ready" as const : "not_ready" as const,
    profile,
    explicit: Boolean(configured),
    distributionChannel: distribution.channel,
    deferredCapabilities: releaseDeferredCapabilities(profile, distribution.channel),
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
