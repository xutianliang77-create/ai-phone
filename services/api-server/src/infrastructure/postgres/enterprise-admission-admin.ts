import process from "node:process";
import {
  getEnterpriseAdmissionOperatorReadiness,
  loadEnterpriseAdmissionPolicyManifest,
} from "./enterprise-admission-config.js";
import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
} from "./enterprise-postgres-client.js";
import {
  applyEnterpriseAdmissionPolicy,
  applyEnterpriseAdmissionWeight,
  readEnterpriseAdmissionStatus,
} from "./enterprise-admission-admin.repository.js";

const command = process.argv[2];
if (command !== "apply" && command !== "status") {
  console.error("Usage: npm run enterprise:admission -- <apply|status>");
  process.exit(1);
}
const operatorId = process.env.ENTERPRISE_ADMISSION_OPERATOR_ID?.trim() ?? "";
const readiness = getEnterpriseAdmissionOperatorReadiness();
if (readiness.status !== "configured") {
  throw new Error(`Enterprise admission config is not ready: ${readiness.issues.join("; ")}`);
}
if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$/.test(operatorId)) {
  throw new Error("ENTERPRISE_ADMISSION_OPERATOR_ID is invalid");
}
const manifest = loadEnterpriseAdmissionPolicyManifest();
const pool = createEnterprisePostgresPool(
  enterprisePostgresConnectionConfig(process.env, "admission"),
);
try {
  if (command === "apply") {
    const now = new Date().toISOString();
    const versions = [];
    for (const policy of manifest.policies) {
      versions.push(await applyEnterpriseAdmissionPolicy({
        pool, operatorId, policy, now,
      }));
    }
    for (const weight of manifest.tenantWeights) {
      await applyEnterpriseAdmissionWeight({ pool, operatorId, weight, now });
    }
    console.log(JSON.stringify({ status: "applied",
      policyCount: versions.length, tenantWeightCount: manifest.tenantWeights.length }));
  } else {
    const statuses = [];
    for (const policy of manifest.policies) {
      statuses.push(await readEnterpriseAdmissionStatus({
        pool, operatorId, cellId: policy.cellId,
        capability: policy.capability,
      }));
    }
    const ready = statuses.every((item) => item.status === "ready" &&
      item.policyStatus === "active" && item.activeUnits <= item.totalLimit);
    console.log(JSON.stringify({ status: ready ? "ready" : "not_ready",
      policies: statuses }));
    if (!ready) process.exitCode = 1;
  }
} finally {
  await pool.end();
}
