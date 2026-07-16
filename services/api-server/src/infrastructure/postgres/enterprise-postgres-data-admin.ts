import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createEnterprisePostgresClient,
  enterprisePostgresConnectionConfig,
} from "./enterprise-postgres-client.js";
import {
  readEnterpriseDataSource,
  type EnterpriseDataSourceType,
} from "./enterprise-postgres-data-source.js";
import {
  importEnterprisePostgresData,
  reconcileEnterprisePostgresData,
} from "./enterprise-postgres-data-transfer.js";

const [command, sourceType, sourceFile] = process.argv.slice(2);
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runEnterprisePostgresDataAdmin(command, sourceType, sourceFile);
}

export async function runEnterprisePostgresDataAdmin(
  action: string | undefined,
  type: string | undefined,
  file: string | undefined,
) {
  assertMaintenanceWindow();
  if (!isSourceType(type) || !file ||
    (action !== "import" && action !== "reconcile")) {
    throw new Error(
      "Usage: enterprise-postgres-data-admin <import|reconcile> " +
        "<json|sqlite> <source-file>",
    );
  }
  const source = readEnterpriseDataSource(type, file);
  const client = createEnterprisePostgresClient(
    enterprisePostgresConnectionConfig(),
  );
  await client.connect();
  try {
    const manifest = action === "import"
      ? await importEnterprisePostgresData(client, source)
      : await reconcileEnterprisePostgresData(client, source);
    process.stdout.write(`${JSON.stringify({
      status: action === "import" ? "imported" : "reconciled",
      sourceType: type,
      sourceFile: resolve(file),
      manifest,
    })}\n`);
  } finally {
    await client.end();
  }
}

function assertMaintenanceWindow(env: NodeJS.ProcessEnv = process.env) {
  if (env.ENTERPRISE_POSTGRES_DATA_MAINTENANCE !== "true") {
    throw new Error(
      "Set ENTERPRISE_POSTGRES_DATA_MAINTENANCE=true while API and workers " +
        "are stopped",
    );
  }
}

function isSourceType(value: string | undefined):
  value is EnterpriseDataSourceType {
  return value === "json" || value === "sqlite";
}
