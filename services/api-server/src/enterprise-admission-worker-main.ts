import { fileURLToPath } from "node:url";
import { getEnterpriseAdmissionOperatorReadiness,
  loadEnterpriseAdmissionPolicyManifest } from
  "./infrastructure/postgres/enterprise-admission-config.js";
import { readEnterpriseAdmissionStatus } from
  "./infrastructure/postgres/enterprise-admission-admin.repository.js";
import { createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig } from
  "./infrastructure/postgres/enterprise-postgres-client.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runEnterpriseAdmissionWorkerMain();
}

export async function runEnterpriseAdmissionWorkerMain() {
  const readiness = getEnterpriseAdmissionOperatorReadiness();
  if (readiness.status !== "configured") {
    throw new Error(`Enterprise admission config is not ready: ${readiness.issues.join("; ")}`);
  }
  const operatorId = process.env.ENTERPRISE_ADMISSION_OPERATOR_ID?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{1,127}$/.test(operatorId)) {
    throw new Error("ENTERPRISE_ADMISSION_OPERATOR_ID is invalid");
  }
  const manifest = loadEnterpriseAdmissionPolicyManifest();
  const intervalMs = boundedInterval(
    process.env.ENTERPRISE_ADMISSION_RECONCILE_INTERVAL_MS,
  );
  const pool = createEnterprisePostgresPool(
    enterprisePostgresConnectionConfig(process.env, "admission"),
  );
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    while (!controller.signal.aborted) {
      for (const policy of manifest.policies) {
        try {
          const status = await readEnterpriseAdmissionStatus({
            pool, operatorId, cellId: policy.cellId,
            capability: policy.capability,
          });
          if (status.status !== "ready" ||
            status.activeUnits > status.totalLimit) {
            process.stderr.write(`${JSON.stringify({
              status: "admission_not_ready", cellId: policy.cellId,
              capability: policy.capability,
            })}\n`);
          }
        } catch {
          process.stderr.write(`${JSON.stringify({
            status: "admission_reconcile_failed", cellId: policy.cellId,
            capability: policy.capability,
          })}\n`);
        }
      }
      await wait(intervalMs, controller.signal);
    }
  } finally {
    await pool.end();
  }
}

function boundedInterval(value: string | undefined) {
  const parsed = Number(value ?? 5_000);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 60_000) {
    throw new Error("ENTERPRISE_ADMISSION_RECONCILE_INTERVAL_MS is invalid");
  }
  return parsed;
}

function wait(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
