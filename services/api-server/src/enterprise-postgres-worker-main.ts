import { pathToFileURL } from "node:url";
import {
  adaptSharedPostgresPool,
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
} from "./infrastructure/postgres/enterprise-postgres-client.js";
import {
  createEnvironmentEnterpriseOutboxPublisher,
} from "./infrastructure/postgres/enterprise-postgres-outbox-publisher.js";
import {
  initializeEnterprisePrimaryRuntime,
} from "./infrastructure/postgres/enterprise-primary-runtime.js";
import {
  loadEnterprisePostgresWorkerConfig,
} from "./infrastructure/postgres/enterprise-postgres-worker-config.js";
import {
  runEnterprisePostgresWorkerLoop,
} from "./infrastructure/postgres/enterprise-postgres-worker.js";
import {
  createEnvironmentTenantLifecycleExecutor,
} from "./modules/enterprise/enterprise-tenant-lifecycle-executor.js";

if (process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runEnterprisePostgresWorkerMain();
}

export async function runEnterprisePostgresWorkerMain() {
  const config = loadEnterprisePostgresWorkerConfig();
  const primaryRuntime = await initializeEnterprisePrimaryRuntime({
    enterpriseDirectoryAccess: false,
  });
  if (
    primaryRuntime.driver !== "postgres" ||
    primaryRuntime.platform.driver !== "postgres"
  ) {
    await primaryRuntime.close();
    throw new Error("Enterprise cell worker requires PostgreSQL Primary Runtime");
  }
  let discoveryPool;
  try {
    discoveryPool = createEnterprisePostgresPool(
      enterprisePostgresConnectionConfig(process.env, "cell"),
    );
  } catch (error) {
    await primaryRuntime.close();
    throw error;
  }
  const tenantPool = adaptSharedPostgresPool(
    primaryRuntime.platform.postgres.pool,
  );
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    await runEnterprisePostgresWorkerLoop({
      discoveryPool,
      tenantPool,
      runtime: primaryRuntime.enterprise,
      config,
      lifecycleExecutor: createEnvironmentTenantLifecycleExecutor(),
      outboxPublisher: createEnvironmentEnterpriseOutboxPublisher(),
      signal: controller.signal,
      onBatch: (result) => {
        if (result.inspected > 0) {
          process.stdout.write(`${JSON.stringify({ status: "processed", ...result })}\n`);
        }
      },
      onError: () => {
        process.stderr.write(
          `${JSON.stringify({ status: "worker_batch_failed" })}\n`,
        );
      },
    });
  } finally {
    try {
      await discoveryPool.end();
    } finally {
      await primaryRuntime.close();
    }
  }
}
