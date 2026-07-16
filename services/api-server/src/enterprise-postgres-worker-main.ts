import { pathToFileURL } from "node:url";
import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
} from "./infrastructure/postgres/enterprise-postgres-client.js";
import {
  createEnvironmentEnterpriseOutboxPublisher,
} from "./infrastructure/postgres/enterprise-postgres-outbox-publisher.js";
import {
  createPostgresEnterpriseRepositoryRuntime,
} from "./infrastructure/postgres/enterprise-postgres-repository-runtime.js";
import {
  runEnterprisePostgresStartupGate,
} from "./infrastructure/postgres/enterprise-postgres-startup-gate.js";
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
  const startup = await runEnterprisePostgresStartupGate();
  if (startup.status !== "verified") {
    throw new Error("Enterprise cell worker requires PostgreSQL startup verify");
  }
  const config = loadEnterprisePostgresWorkerConfig();
  const pool = createEnterprisePostgresPool(
    enterprisePostgresConnectionConfig(),
  );
  const runtime = createPostgresEnterpriseRepositoryRuntime(pool);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  try {
    await runEnterprisePostgresWorkerLoop({
      pool,
      runtime,
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
    await runtime.close();
  }
}
