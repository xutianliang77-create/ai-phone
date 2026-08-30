import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getEnterpriseAdmissionConfigReadiness,
  loadEnterpriseAdmissionPolicyManifest } from "./enterprise-admission-config.js";

describe("enterprise admission config", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((dir) =>
    rmSync(dir, { recursive: true, force: true })));

  it("loads one candidate-bound bounded policy", () => {
    const file = policyFile(dirs);
    expect(loadEnterpriseAdmissionPolicyManifest(file).policies[0]).toMatchObject({
      capability: "translation_runtime",
      totalConcurrencyLimit: 100,
      defaultTenantConcurrencyLimit: 8,
    });
    expect(getEnterpriseAdmissionConfigReadiness({
      API_STORAGE_DRIVER: "postgres",
      ENTERPRISE_ADMISSION_ENABLED: "true",
      ENTERPRISE_ADMISSION_DATABASE_URL: "postgresql://admission/db",
      ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL:
        "postgresql://admission-observer/db",
      ENTERPRISE_ADMISSION_OPERATOR_ID: "operator-01",
      ENTERPRISE_ADMISSION_POLICY_FILE: file,
    }).status).toBe("configured");
  });

  it("fails closed for disabled or duplicate policy entries", () => {
    expect(getEnterpriseAdmissionConfigReadiness({}).status).toBe("disabled");
    const file = policyFile(dirs, true);
    expect(() => loadEnterpriseAdmissionPolicyManifest(file)).toThrow("unique");
  });
});

function policyFile(dirs: string[], duplicate = false) {
  const dir = mkdtempSync(join(tmpdir(), "admission-policy-"));
  dirs.push(dir);
  const base = {
    cellId: "cn-cell-01", capability: "translation_runtime",
    totalConcurrencyLimit: 100, defaultTenantConcurrencyLimit: 8,
    defaultRateLimit: 60, rateWindowSeconds: 60, totalQueueLimit: 500,
    defaultTenantQueueLimit: 50, queueTtlSeconds: 120,
    status: "active", expectedVersion: 0,
  };
  const policies = ["translation_runtime", "voice_agent_runtime",
    "marketing_pstn", "screen_share"].map((capability) => ({
      ...base, capability,
    }));
  const file = join(dir, "policy.json");
  writeFileSync(file, JSON.stringify({ schemaVersion: 1,
    candidateCommit: "a".repeat(40), imageDigest: `sha256:${"b".repeat(64)}`,
    policies: duplicate ? [...policies, policies[0]] : policies,
    tenantWeights: [] }));
  return file;
}
