import { describe, expect, test } from "vitest";
import { checkDependencySecurity } from "./dependency_security.mjs";

describe("checkDependencySecurity", () => {
  test("accepts only the reviewed OTel chain before expiry", () => {
    const input = fixture();
    expect(checkDependencySecurity(input, new Date("2026-07-18T00:00:00Z")))
      .toMatchObject({ status: "accepted_with_temporary_exception", issues: [] });
  });

  test("fails an unexpected high vulnerability", () => {
    const input = fixture();
    input.audit.metadata.vulnerabilities.high = 1;
    expect(checkDependencySecurity(input).issues.join(" ")).toContain("high");
  });

  test("fails after the exception expires", () => {
    const input = fixture();
    expect(checkDependencySecurity(input, new Date("2026-09-01T00:00:00Z"))
      .issues.join(" ")).toContain("expired");
  });
});

function fixture() {
  const names = ["@livekit/agents", "@opentelemetry/core"];
  const vulnerabilities = Object.fromEntries(names.map((name) => [name, {
    severity: "moderate",
    isDirect: name === "@livekit/agents",
    via: name === "@opentelemetry/core"
      ? [{ url: "https://github.com/advisories/GHSA-8988-4f7v-96qf" }] : [],
  }]));
  return {
    audit: {
      metadata: {
        vulnerabilities: { info: 0, low: 0, moderate: 2, high: 0, critical: 0 },
      },
      vulnerabilities,
    },
    policy: {
      schemaVersion: 1,
      status: "accepted_temporary_exception",
      advisory: "GHSA-8988-4f7v-96qf",
      severity: "moderate",
      expiresAt: "2026-08-31T23:59:59+08:00",
      upstreamPackage: "@livekit/agents",
      upstreamVersion: "1.5.0",
      allowedVulnerabilities: names,
      requiredDirectVersions: { "@opentelemetry/core": "2.9.0" },
      requiredSourceMarkers: ["W3CTraceContextPropagator"],
      reachability: {
        publicInboundBaggageUsed: false,
        livekitAgentsPropagationExtractFound: false,
        agentProcessesHavePublicOtelHttpInstrumentation: false,
      },
    },
    apiDependencies: { "@opentelemetry/core": "2.9.0" },
    agentVersions: ["1.5.0", "1.5.0"],
    telemetrySource: "W3CTraceContextPropagator",
  };
}
