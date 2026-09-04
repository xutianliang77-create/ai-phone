import { describe, expect, test } from "vitest";
import { checkDependencySecurity } from "./dependency_security.mjs";

describe("checkDependencySecurity", () => {
  test("accepts a clean audit with reviewed direct versions", () => {
    const input = fixture();
    expect(checkDependencySecurity(input))
      .toMatchObject({ status: "ready", issues: [] });
  });

  test("fails any known vulnerability", () => {
    const input = fixture();
    input.audit.metadata.vulnerabilities.high = 1;
    input.audit.vulnerabilities.fastify = { severity: "high" };
    expect(checkDependencySecurity(input).issues.join(" "))
      .toContain("Known production dependency vulnerabilities");
  });

  test("fails LiveKit version drift", () => {
    const input = fixture();
    input.agentPluginVersion = "1.6.3";
    expect(checkDependencySecurity(input).issues.join(" "))
      .toContain("OpenAI plugin version");
  });
});

function fixture() {
  return {
    audit: {
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 0,
          critical: 0,
          total: 0,
        },
      },
      vulnerabilities: {},
    },
    policy: {
      schemaVersion: 2,
      status: "enforced_zero_known_vulnerabilities",
      requiredDirectVersions: { "@opentelemetry/core": "2.9.0" },
      requiredLiveKitVersions: {
        "@livekit/agents": "1.6.4",
        "@livekit/agents-plugin-openai": "1.6.4",
      },
      requiredSourceMarkers: ["W3CTraceContextPropagator"],
    },
    apiDependencies: { "@opentelemetry/core": "2.9.0" },
    agentVersions: ["1.6.4", "1.6.4"],
    agentPluginVersion: "1.6.4",
    telemetrySource: "W3CTraceContextPropagator",
  };
}
