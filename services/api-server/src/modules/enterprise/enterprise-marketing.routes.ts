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

export function registerEnterpriseMarketingRoutes(app: FastifyInstance,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime) {
  const evidenceStore = createEnvironmentMarketingConsentEvidenceStore();
  app.addHook("onClose", () => evidenceStore.close());
  registerEnterpriseCampaignRoutes(app, routeService, runtime);
  registerEnterpriseLeadImportRoutes(app, routeService, runtime);
  registerEnterpriseMarketingConsentRoutes(app, routeService, runtime, evidenceStore);
  registerEnterpriseMarketingSuppressionRoutes(app, routeService, runtime,
    unavailableEnterpriseGlobalSuppressionRegistry());
}
