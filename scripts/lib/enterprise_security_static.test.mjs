import { describe, expect, test } from "vitest";
import {
  enterpriseStaticRuleIds,
  scanEnterpriseStaticSecurity,
} from "./enterprise_security_static.mjs";

describe("enterprise static security gate", () => {
  test("blocks production dynamic code, reflected CORS and secret material", () => {
    const secret = ["sk-proj", "A".repeat(40)].join("-");
    const result = scanEnterpriseStaticSecurity({
      policy: policy(),
      files: [
        source("services/api/src/app.ts", 'import cors from "@fastify/cors";\nconst x = new Function("return 1");\nconst options = { origin: true };'),
        source("docs/private.txt", secret),
      ],
    });
    expect(result.status).toBe("not_ready");
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "ENT-SAST-002", "ENT-SAST-005", "ENT-SECRET-004",
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test("does not confuse regex exec, placeholders or test-only fixtures with findings", () => {
    const result = scanEnterpriseStaticSecurity({
      policy: policy(),
      files: [
        source("services/api/src/safe.ts", 'const match = /x/.exec(value);\nconst origin = false;'),
        source("services/api/src/safe.test.ts", 'const x = new Function("return fixture");'),
        source("infra/example.env", "OPENAI_API_KEY=replace-with-provider-key"),
      ],
    });
    expect(result).toMatchObject({ status: "pass", findings: [], issues: [] });
  });

  test("blocks production mobile TLS bypasses but permits debug-only cleartext", () => {
    const result = scanEnterpriseStaticSecurity({
      policy: policy(),
      files: [
        source("apps/mobile/ios/Runner/Info.plist", "<key>NSAllowsArbitraryLoads</key>"),
        source("apps/mobile/lib/network.dart", "client.badCertificateCallback = (_, __, ___) => true;"),
        source("apps/mobile/android/app/src/debug/AndroidManifest.xml", 'android:usesCleartextTraffic="true"'),
      ],
    });
    expect(result.findings.map((finding) => finding.ruleId)).toEqual([
      "ENT-SAST-010", "ENT-SAST-014",
    ]);
  });

  test("fails closed when the policy drops a scanner rule", () => {
    const value = policy();
    value.requiredStaticRuleIds.pop();
    expect(scanEnterpriseStaticSecurity({ policy: value, files: [] }).issues)
      .toContain("Security policy static rule manifest differs from implementation");
  });
});

function policy() {
  return {
    schemaVersion: 1,
    blockedSeverities: ["P0", "P1"],
    requiredStaticRuleIds: [...enterpriseStaticRuleIds],
  };
}

function source(path, content) {
  return { path, content };
}
