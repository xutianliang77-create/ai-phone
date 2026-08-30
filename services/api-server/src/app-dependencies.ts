import type { TenantProvisioner } from
  "./modules/enterprise/enterprise-tenant-provisioner.js";
import type { TenantRouteService } from
  "./modules/enterprise/enterprise-tenant-route.js";
import type { EnterpriseProviderReadinessService } from
  "./modules/enterprise/enterprise-provider-readiness.js";
import type { TenantLifecycleExecutor } from
  "./modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import type { EnterpriseAuditCursorService } from
  "./modules/enterprise/enterprise-audit-cursor.js";
import type { EnterpriseSupportAgentProvider } from
  "./modules/enterprise/enterprise-support-agent-provider.js";
import type { EnterpriseSupportAgentDispatchService } from
  "./modules/enterprise/enterprise-support-agent-dispatch.js";
import type { EnterpriseMeetingMaterialProvider } from
  "./modules/enterprise/enterprise-meeting-material-provider.js";
import type { EnterpriseMeetingScreenShareProvider } from
  "./modules/enterprise/enterprise-meeting-screen-share-provider.js";
import type { EnterpriseMeetingScreenOcrDispatchService } from
  "./modules/enterprise/enterprise-meeting-screen-ocr-dispatch.js";
import type { EnterpriseMeetingInviteTokenService } from
  "./modules/enterprise/enterprise-meeting-invite-token.js";
import type { EnterpriseMeetingTranslationDispatchService } from
  "./modules/enterprise/enterprise-meeting-translation-dispatch.js";
import type { EnterpriseAuditExportArtifactStore } from
  "./modules/enterprise/enterprise-audit-export-artifact-store.js";
import type { EnterpriseRepositoryRuntime } from
  "./modules/enterprise/enterprise-repository-runtime.js";
import type { EnterpriseSupportInboundTicketService } from
  "./modules/enterprise/enterprise-support-inbound-ticket.js";
import type { EnterpriseControlPlaneAvailabilityService } from
  "./modules/enterprise/enterprise-control-plane-availability.js";

export interface AppDependencies {
  tenantProvisioner?: TenantProvisioner;
  tenantRouteService?: TenantRouteService;
  tenantLifecycleExecutor?: TenantLifecycleExecutor;
  providerReadinessService?: EnterpriseProviderReadinessService;
  auditCursorService?: EnterpriseAuditCursorService;
  auditExportArtifactStore?: EnterpriseAuditExportArtifactStore;
  enterpriseRepositoryRuntime?: EnterpriseRepositoryRuntime;
  enterpriseMeetingInviteTokenService?: EnterpriseMeetingInviteTokenService;
  enterpriseMeetingTranslationDispatchService?:
    EnterpriseMeetingTranslationDispatchService;
  enterpriseMeetingScreenShareProvider?: EnterpriseMeetingScreenShareProvider;
  enterpriseMeetingMaterialProvider?: EnterpriseMeetingMaterialProvider;
  enterpriseMeetingScreenOcrDispatch?: EnterpriseMeetingScreenOcrDispatchService;
  enterpriseSupportInboundTicketService?: EnterpriseSupportInboundTicketService;
  enterpriseSupportAgentProvider?: EnterpriseSupportAgentProvider;
  enterpriseSupportAgentDispatchService?: EnterpriseSupportAgentDispatchService;
  enterpriseControlPlaneAvailability?: EnterpriseControlPlaneAvailabilityService;
}
