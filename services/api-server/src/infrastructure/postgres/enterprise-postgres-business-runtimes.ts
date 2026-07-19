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
import { createEnterprisePostgresSupportQualityRuntime } from
  "./enterprise-postgres-support-quality-runtime.js";
import { createEnterpriseSupportWriteCommandService } from
  "../../modules/enterprise/enterprise-support-write-command.js";
import { unavailableEnterpriseSupportWriteAdapter } from
  "../../modules/enterprise/enterprise-support-write-tool.js";
import { createEnterprisePostgresCampaignRuntime } from
  "./enterprise-postgres-campaign-runtime.js";
import { createEnterprisePostgresLeadImportRuntime } from
  "./enterprise-postgres-lead-import-runtime.js";
import { createEnterprisePostgresMarketingConsentRuntime } from
  "./enterprise-postgres-marketing-consent-runtime.js";
import { createEnterprisePostgresMarketingSuppressionRuntime } from
  "./enterprise-postgres-marketing-suppression-runtime.js";
import { createEnterprisePostgresMarketingCountryPolicyRuntime } from
  "./enterprise-postgres-marketing-country-policy-runtime.js";
import { createEnterprisePostgresCampaignApprovalRuntime } from
  "./enterprise-postgres-campaign-approval-runtime.js";
import { createEnterprisePostgresMarketingSchedulerRuntime } from
  "./enterprise-postgres-marketing-scheduler-runtime.js";
import { createEnterprisePostgresMarketingPstnRuntime } from
  "./enterprise-postgres-marketing-pstn-runtime.js";

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
    ...createEnterprisePostgresSupportQualityRuntime(pool),
    ...createEnterprisePostgresSupportAgentRuntime(pool),
    ...createEnterprisePostgresSupportToolRuntime(pool),
    ...createEnterprisePostgresSupportReadToolRuntime(pool),
    ...createEnterprisePostgresSupportWriteToolRuntime(pool, supportWriteCommand),
    ...createEnterprisePostgresCampaignRuntime(pool),
    ...createEnterprisePostgresLeadImportRuntime(pool),
    ...createEnterprisePostgresMarketingConsentRuntime(pool),
    ...createEnterprisePostgresMarketingSuppressionRuntime(pool),
    ...createEnterprisePostgresMarketingCountryPolicyRuntime(pool),
    ...createEnterprisePostgresCampaignApprovalRuntime(pool),
    ...createEnterprisePostgresMarketingSchedulerRuntime(pool),
    ...createEnterprisePostgresMarketingPstnRuntime(pool),
  };
}
