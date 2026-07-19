import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterprisePostgresMeetingFeatureRuntimes } from
  "./enterprise-postgres-meeting-feature-runtimes.js";
import { createEnterprisePostgresSupportRuntime } from
  "./enterprise-postgres-support-runtime.js";
import { createEnterprisePostgresSupportAgentRuntime } from
  "./enterprise-postgres-support-agent-runtime.js";
import { createEnterprisePostgresSupportToolRuntime } from
  "./enterprise-postgres-support-tool-runtime.js";
import { createEnterprisePostgresSupportReadToolRuntime } from
  "./enterprise-postgres-support-read-tool-runtime.js";
import { createEnterprisePostgresSupportWriteToolRuntime } from
  "./enterprise-postgres-support-write-tool-runtime.js";
import { createEnterprisePostgresSupportAgentQueueRuntime } from
  "./enterprise-postgres-support-agent-queue-runtime.js";
import { createEnterprisePostgresSupportWorkbenchRuntime } from
  "./enterprise-postgres-support-workbench-runtime.js";
import { createEnterprisePostgresSupportFollowupRuntime } from
  "./enterprise-postgres-support-followup-runtime.js";
import { createEnterpriseSupportWriteCommandService } from
  "../../modules/enterprise/enterprise-support-write-command.js";
import { unavailableEnterpriseSupportWriteAdapter } from
  "../../modules/enterprise/enterprise-support-write-tool.js";

export function createEnterprisePostgresBusinessRuntimes(
  pool: EnterpriseTenantPostgresPool,
  dispatchSigningSecret: string,
) {
  const supportWriteCommand = createEnterpriseSupportWriteCommandService({
    adapter: unavailableEnterpriseSupportWriteAdapter(),
  });
  return {
    ...createEnterprisePostgresMeetingFeatureRuntimes(pool, dispatchSigningSecret),
    ...createEnterprisePostgresSupportRuntime(pool),
    ...createEnterprisePostgresSupportAgentQueueRuntime(pool),
    ...createEnterprisePostgresSupportWorkbenchRuntime(pool, supportWriteCommand),
    ...createEnterprisePostgresSupportFollowupRuntime(pool, supportWriteCommand),
    ...createEnterprisePostgresSupportAgentRuntime(pool),
    ...createEnterprisePostgresSupportToolRuntime(pool),
    ...createEnterprisePostgresSupportReadToolRuntime(pool),
    ...createEnterprisePostgresSupportWriteToolRuntime(pool, supportWriteCommand),
  };
}
