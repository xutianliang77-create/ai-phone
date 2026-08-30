import process from "node:process";
import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
} from "./enterprise-postgres-client.js";
import { loadEnterpriseControlPlaneObserverConfig } from
  "./enterprise-control-plane-config.js";
import { enterpriseControlPlaneStatus } from
  "./enterprise-control-plane.repository.js";

const command = process.argv[2];
if (command !== "status") {
  console.error("Usage: npm run enterprise:control-plane -- status");
  process.exit(1);
}

const config = loadEnterpriseControlPlaneObserverConfig();
const pool = createEnterprisePostgresPool(
  enterprisePostgresConnectionConfig(process.env, "control_plane_observer"),
);
try {
  const result = await enterpriseControlPlaneStatus({
    pool,
    config,
    traceId: `control-plane-status:${Date.now()}`,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ready") process.exitCode = 1;
} finally {
  await pool.end();
}
