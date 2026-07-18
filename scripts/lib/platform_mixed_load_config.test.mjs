import { describe, expect, it } from "vitest";
import { validatePlatformMixedLoadConfig } from "./platform_mixed_load_config.mjs";

describe("platform mixed-load config", () => {
  it("accepts the isolated real 25/50/100 and 120-minute contract", () => {
    const checked = validatePlatformMixedLoadConfig(validConfig("real"));

    expect(checked.status).toBe("ready");
    expect(checked.issues).toEqual([]);
  });

  it("does not accept mock mode as release evidence", () => {
    const checked = validatePlatformMixedLoadConfig(validConfig("mock"));

    expect(checked.status).toBe("not_ready");
    expect(checked.issues).toContain("Release mixed-load acceptance requires real mode");
    expect(validatePlatformMixedLoadConfig(validConfig("mock"), { release: false }).status)
      .toBe("ready");
  });

  it("rejects missing traffic, unsafe shell commands, and non-allowlisted APIs", () => {
    const config = validConfig("real");
    config.safety.allowedApiHosts = ["other-staging.example.cn"];
    config.scenarios[1].trafficKinds = ["api"];
    config.scenarios[1].command = { file: "sh -c dangerous", args: "not-an-array" };
    const checked = validatePlatformMixedLoadConfig(config);

    expect(checked.status).toBe("not_ready");
    expect(checked.issues).toContain("API hostname must be explicitly allowlisted");
    expect(checked.issues).toContain("Scenario mix does not cover sip");
    expect(checked.issues).toContain(
      "Scenario telephony_agent command must use an executable and argument array",
    );
  });
});

function validConfig(mode) {
  return {
    schemaVersion: 1,
    environment: "staging",
    mode,
    topologyFile: "infra/platform-ha/topology.json",
    safety: {
      apiBaseUrl: mode === "real"
        ? "https://api-staging.qkxy.cn"
        : "http://127.0.0.1:3410",
      allowedApiHosts: mode === "real" ? ["api-staging.qkxy.cn"] : ["127.0.0.1"],
      acknowledgement: "WUJIE_STAGING_LOAD_ONLY",
      gracefulDrainSeconds: 30,
      maxPendingStarts: 150,
      systemSampleDelaySeconds: 30,
    },
    stages: [
      { concurrentSessions: 25, durationMinutes: 30, rampUpSeconds: 60 },
      { concurrentSessions: 50, durationMinutes: 10, rampUpSeconds: 120 },
      { concurrentSessions: 100, durationMinutes: 30, rampUpSeconds: 300 },
    ],
    soak: { concurrentSessions: 70, durationMinutes: 120, targetUtilization: 0.7 },
    admission: {
      concurrentSessions: 120,
      durationMinutes: 10,
      minimumObservedUtilization: 0.85,
    },
    slo: {
      maxErrorRate: 0.01,
      p95SessionStartMs: 5000,
      p95FinalLatencyMs: 2000,
      minimumFinalCoverageRatio: 0.99,
    },
    systemProbe: { file: "node", args: ["scripts/probe.mjs"] },
    scenarios: [
      {
        name: "translation_room",
        weight: 70,
        trafficKinds: ["api", "livekit", "asr", "mt", "tts"],
        command: { file: "node", args: ["scripts/session.mjs"] },
      },
      {
        name: "telephony_agent",
        weight: 30,
        trafficKinds: ["api", "livekit", "sip", "agent", "egress"],
        command: { file: "node", args: ["scripts/session.mjs"] },
      },
    ],
    failureInjections: [{
      name: "worker_sigkill",
      phase: "capacity-100",
      atSeconds: 300,
      recoveryTimeoutSeconds: 120,
      command: { file: "node", args: ["scripts/failure.mjs"] },
    }],
  };
}
