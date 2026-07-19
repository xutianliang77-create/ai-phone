import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterprisePostgresMeetingFeatureRuntimes } from
  "./enterprise-postgres-meeting-feature-runtimes.js";
import { createEnterprisePostgresSupportRuntime } from
  "./enterprise-postgres-support-runtime.js";
import { createEnterprisePostgresSupportAgentRuntime } from
  "./enterprise-postgres-support-agent-runtime.js";

export function createEnterprisePostgresBusinessRuntimes(
  pool: EnterpriseTenantPostgresPool,
  dispatchSigningSecret: string,
) {
  return {
    ...createEnterprisePostgresMeetingFeatureRuntimes(pool, dispatchSigningSecret),
    ...createEnterprisePostgresSupportRuntime(pool),
    ...createEnterprisePostgresSupportAgentRuntime(pool),
  };
}
