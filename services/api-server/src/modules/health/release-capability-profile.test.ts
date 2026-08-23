import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getReleaseCapabilityProfileReadiness } from
  "./release-capability-profile.js";

const keys = [
  "DOMESTIC_RELEASE_CAPABILITY_PROFILE",
  "CALL_PROVIDER_POLICY",
  "AGENT_CALL_WORKER_ENABLED",
  "VOICE_AGENT_ENABLED",
  "VOICE_AGENT_ASSIST_ENABLED",
  "VOICE_AGENT_AUTONOMOUS_ENABLED",
  "VOICE_AGENT_OPERATOR_CONSULT_ENABLED",
  "LIVEKIT_EGRESS_ENABLED",
  "LIVEKIT_EGRESS_ARTIFACT_WORKER_ENABLED",
];

describe("release capability profile", () => {
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
  });

  afterEach(() => {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("defaults safely to core translation with provider capabilities deferred", () => {
    expect(getReleaseCapabilityProfileReadiness()).toEqual({
      status: "ready",
      profile: "core_translation",
      explicit: false,
      deferredCapabilities: ["livekit_sip", "agent", "egress", "payment"],
      issues: [],
    });
  });

  it("rejects enabled deferred capabilities in core translation", () => {
    process.env.DOMESTIC_RELEASE_CAPABILITY_PROFILE = "core_translation";
    process.env.CALL_PROVIDER_POLICY = "pstn_enabled";
    process.env.LIVEKIT_EGRESS_ENABLED = "true";

    const result = getReleaseCapabilityProfileReadiness();

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain(
      "CALL_PROVIDER_POLICY must be call_link_only for core_translation",
    );
    expect(result.issues).toContain(
      "LIVEKIT_EGRESS_ENABLED must be false for core_translation",
    );
  });

  it("requires PSTN, Agent, and Egress switches for commercial full", () => {
    process.env.DOMESTIC_RELEASE_CAPABILITY_PROFILE = "commercial_full";

    const result = getReleaseCapabilityProfileReadiness();

    expect(result.status).toBe("not_ready");
    expect(result.deferredCapabilities).toEqual([]);
    expect(result.issues).toContain(
      "CALL_PROVIDER_POLICY must enable PSTN for commercial_full",
    );
    expect(result.issues).toContain(
      "AGENT_CALL_WORKER_ENABLED must be true for commercial_full",
    );
    expect(result.issues).toContain(
      "LIVEKIT_EGRESS_ENABLED must be true for commercial_full",
    );
  });
});
