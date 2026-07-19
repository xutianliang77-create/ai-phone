import type { FastifyInstance } from "fastify";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { registerEnterpriseCampaignRoutes } from "./enterprise-campaign.routes.js";
import { registerEnterpriseLeadImportRoutes } from "./enterprise-lead-import.routes.js";
import { createEnvironmentMarketingConsentEvidenceStore } from
  "./enterprise-marketing-consent-evidence-store.js";
import { registerEnterpriseMarketingConsentRoutes } from
  "./enterprise-marketing-consent.routes.js";
import { unavailableEnterpriseGlobalSuppressionRegistry } from
  "./enterprise-global-suppression-registry.js";
import { registerEnterpriseMarketingSuppressionRoutes } from
  "./enterprise-marketing-suppression.routes.js";
import { registerEnterpriseMarketingCountryPolicyRoutes } from
  "./enterprise-marketing-country-policy.routes.js";
import { registerEnterpriseCampaignApprovalRoutes } from
  "./enterprise-campaign-approval.routes.js";
import { registerEnterpriseMarketingSchedulerRoutes } from
  "./enterprise-marketing-scheduler.routes.js";
import { createEnvironmentEnterpriseMarketingPstnProvider } from
  "./enterprise-marketing-pstn-provider.js";
import { registerEnterpriseMarketingPstnRoutes } from
  "./enterprise-marketing-pstn.routes.js";
import { createEnvironmentEnterpriseMarketingAgentProvider } from
  "./enterprise-marketing-agent-provider.js";
import { createEnvironmentEnterpriseMarketingAgentRuntimeBinding } from
  "./enterprise-marketing-agent-ticket.js";
import { registerEnterpriseMarketingAgentRoutes } from
  "./enterprise-marketing-agent.routes.js";

export function registerEnterpriseMarketingRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime) {
  const evidenceStore = createEnvironmentMarketingConsentEvidenceStore();
  app.addHook("onClose", () => evidenceStore.close());
  registerEnterpriseCampaignRoutes(app, routeService, runtime);
  registerEnterpriseLeadImportRoutes(app, routeService, runtime);
  registerEnterpriseMarketingConsentRoutes(app, routeService, runtime, evidenceStore);
  registerEnterpriseMarketingSuppressionRoutes(app, routeService, runtime,
    unavailableEnterpriseGlobalSuppressionRegistry());
  registerEnterpriseMarketingCountryPolicyRoutes(app, routeService, runtime);
  registerEnterpriseCampaignApprovalRoutes(app, routeService, runtime);
  registerEnterpriseMarketingSchedulerRoutes(app, routeService, runtime);
  const agentProvider = createEnvironmentEnterpriseMarketingAgentProvider();
  const agentBinding = createEnvironmentEnterpriseMarketingAgentRuntimeBinding();
  registerEnterpriseMarketingAgentRoutes(app, routeService, runtime,
    agentProvider, agentBinding);
  registerEnterpriseMarketingPstnRoutes(app, routeService, runtime,
    createEnvironmentEnterpriseMarketingPstnProvider(), agentProvider, agentBinding);
}
