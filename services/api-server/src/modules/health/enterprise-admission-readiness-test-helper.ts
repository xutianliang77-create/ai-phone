import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function configureEnterpriseAdmissionEnv(tempDirs: string[]) {
  const root = mkdtempSync(join(tmpdir(), "enterprise-admission-"));
  tempDirs.push(root);
  const file = join(root, "policy.json");
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    candidateCommit: "a".repeat(40),
    imageDigest: `sha256:${"b".repeat(64)}`,
    policies: ["translation_runtime", "voice_agent_runtime", "marketing_pstn",
      "screen_share"].map((capability) => ({
      cellId: "cn-cell-01",
      capability,
      totalConcurrencyLimit: 100,
      defaultTenantConcurrencyLimit: 8,
      defaultRateLimit: 60,
      rateWindowSeconds: 60,
      totalQueueLimit: 500,
      defaultTenantQueueLimit: 50,
      queueTtlSeconds: 120,
      status: "active",
      expectedVersion: 0,
    })),
    tenantWeights: [],
  }));
  process.env.API_STORAGE_DRIVER = "postgres";
  process.env.ENTERPRISE_ADMISSION_ENABLED = "true";
  process.env.ENTERPRISE_ADMISSION_DATABASE_URL = "postgresql://admission/db";
  process.env.ENTERPRISE_ADMISSION_OBSERVER_DATABASE_URL =
    "postgresql://admission-observer/db";
  process.env.ENTERPRISE_ADMISSION_OPERATOR_ID = "admission-operator";
  process.env.ENTERPRISE_ADMISSION_POLICY_FILE = file;
}
