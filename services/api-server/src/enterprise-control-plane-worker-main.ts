import { fileURLToPath } from "node:url";
import { initializeEnterprisePrimaryRuntime } from
  "./infrastructure/postgres/enterprise-primary-runtime.js";
import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
} from "./infrastructure/postgres/enterprise-postgres-client.js";
import { loadEnterpriseControlPlaneConfig } from
  "./infrastructure/postgres/enterprise-control-plane-config.js";
import { runEnterpriseControlPlaneWorker } from
  "./infrastructure/postgres/enterprise-control-plane-worker.js";
import { createEnvironmentTenantProvisioner } from
  "./modules/enterprise/enterprise-tenant-provisioner.js";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runEnterpriseControlPlaneWorkerMain();
}

export async function runEnterpriseControlPlaneWorkerMain() {
  const config = loadEnterpriseControlPlaneConfig();
  const primary = await initializeEnterprisePrimaryRuntime({
    enterpriseDirectoryAccess: false,
  });
  if (primary.driver !== "postgres" || primary.platform.driver !== "postgres") {
    await primary.close();
    throw new Error("Enterprise control-plane worker requires PostgreSQL Primary Runtime");
  }
  let pool;
  try {
    pool = createEnterprisePostgresPool(
      enterprisePostgresConnectionConfig(process.env, "control_plane"),
    );
  } catch (error) {
    await primary.close();
    throw error;
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    await runEnterpriseControlPlaneWorker({
      pool,
      runtime: primary.enterprise,
      provisioner: createEnvironmentTenantProvisioner(),
      config,
      signal: controller.signal,
      onBatch: (result) => {
        if (result.inspected > 0) {
          process.stdout.write(`${JSON.stringify({ status: "processed", ...result })}\n`);
        }
      },
      onError: () => {
        process.stderr.write(`${JSON.stringify({ status: "control_plane_error" })}\n`);
      },
    });
  } finally {
    try {
      await pool.end();
    } finally {
      await primary.close();
    }
  }
}
