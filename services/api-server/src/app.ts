import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  logRedactionPaths,
  redactLogObject,
  redactLogString,
} from "@translation/contracts";
import { registerAccountRoutes } from "./modules/account/account.routes.js";
import { registerAgentCallRoutes } from "./modules/agent-calls/agent-calls.routes.js";
import { registerBillingRoutes } from "./modules/billing/billing.routes.js";
import { registerCallLinkRoutes } from "./modules/call-links/call-links.routes.js";
import { registerDiagnosticsRoutes } from "./modules/diagnostics/diagnostics.routes.js";
import { registerEnterpriseTenantRoutes } from "./modules/enterprise/enterprise-tenants.routes.js";
import {
  createEnvironmentTenantProvisioner,
  type TenantProvisioner,
} from "./modules/enterprise/enterprise-tenant-provisioner.js";
import {
  createEnvironmentTenantRouteService,
  type TenantRouteService,
} from "./modules/enterprise/enterprise-tenant-route.js";
import {
  createEnterpriseProviderReadinessService,
  type EnterpriseProviderReadinessService,
} from "./modules/enterprise/enterprise-provider-readiness.js";
import { registerEnterpriseProviderReadinessRoutes } from "./modules/enterprise/enterprise-provider-readiness.routes.js";
import {
  registerEnterpriseCommunicationPolicyRoutes,
} from "./modules/enterprise/enterprise-communication-policy.routes.js";
import {
  registerEnterpriseUsageBudgetRoutes,
} from "./modules/enterprise/enterprise-usage-budget.routes.js";
import {
  registerEnterpriseUsageAccountingRoutes,
} from "./modules/enterprise/enterprise-usage-accounting.routes.js";
import {
  registerEnterpriseBillingEntitlementRoutes,
} from "./modules/enterprise/enterprise-billing-entitlement.routes.js";
import {
  registerEnterpriseKnowledgeRoutes,
} from "./modules/enterprise/enterprise-knowledge.routes.js";
import {
  registerEnterpriseTerminologyRoutes,
} from "./modules/enterprise/enterprise-terminology.routes.js";
import {
  registerEnterpriseScriptTemplateRoutes,
} from "./modules/enterprise/enterprise-script-template.routes.js";
import {
  createEnvironmentTenantLifecycleExecutor,
  type TenantLifecycleExecutor,
} from "./modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import {
  createEnvironmentEnterpriseAuditCursorService,
  type EnterpriseAuditCursorService,
} from "./modules/enterprise/enterprise-audit-cursor.js";
import {
  registerEnterpriseAuditRoutes,
} from "./modules/enterprise/enterprise-audit.routes.js";
import {
  registerEnterpriseObservabilityRoutes,
} from "./modules/enterprise/enterprise-observability.routes.js";
import { registerEnterpriseAuditExportRoutes } from
  "./modules/enterprise/enterprise-audit-export.routes.js";
import { registerEnterpriseMeetingRoutes } from
  "./modules/enterprise/enterprise-meeting.routes.js";
import { registerEnterpriseMeetingScreenShareRoutes } from
  "./modules/enterprise/enterprise-meeting-screen-share.routes.js";
import { registerEnterpriseMeetingMaterialRoutes } from
  "./modules/enterprise/enterprise-meeting-material.routes.js";
import { registerEnterpriseMeetingScreenOcrRoutes } from
  "./modules/enterprise/enterprise-meeting-screen-ocr.routes.js";
import { registerEnterpriseMeetingCalendarRoutes } from
  "./modules/enterprise/enterprise-meeting-calendar.routes.js";
import { registerEnterpriseSupportChannelRoutes } from
  "./modules/enterprise/enterprise-support-channel.routes.js";
import { registerEnterpriseSupportRagRoutes } from
  "./modules/enterprise/enterprise-support-rag.routes.js";
import {
  createEnvironmentEnterpriseMeetingMaterialProvider,
  type EnterpriseMeetingMaterialProvider,
} from "./modules/enterprise/enterprise-meeting-material-provider.js";
import {
  createEnvironmentEnterpriseMeetingScreenShareProvider,
  type EnterpriseMeetingScreenShareProvider,
} from "./modules/enterprise/enterprise-meeting-screen-share-provider.js";
import {
  createEnvironmentEnterpriseMeetingScreenOcrDispatchService,
  type EnterpriseMeetingScreenOcrDispatchService,
} from "./modules/enterprise/enterprise-meeting-screen-ocr-dispatch.js";
import {
  createEnvironmentEnterpriseMeetingInviteTokenService,
  type EnterpriseMeetingInviteTokenService,
} from "./modules/enterprise/enterprise-meeting-invite-token.js";
import {
  createEnvironmentEnterpriseMeetingTranslationDispatchService,
  type EnterpriseMeetingTranslationDispatchService,
} from "./modules/enterprise/enterprise-meeting-translation-dispatch.js";
import {
  createEnvironmentAuditExportArtifactStore,
  type EnterpriseAuditExportArtifactStore,
} from "./modules/enterprise/enterprise-audit-export-artifact-store.js";
import {
  legacyEnterpriseRepositoryRuntime,
  type EnterpriseRepositoryRuntime,
} from "./modules/enterprise/enterprise-repository-runtime.js";
import {
  createEnvironmentEnterpriseSupportInboundTicketService,
  type EnterpriseSupportInboundTicketService,
} from "./modules/enterprise/enterprise-support-inbound-ticket.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerModelRoutes } from "./modules/models/models.routes.js";
import { registerPlansRoutes } from "./modules/plans/plans.routes.js";
import { registerRealtimeRoutes } from "./modules/realtime/realtime.routes.js";
import { registerSessionsRoutes } from "./modules/sessions/sessions.routes.js";
import { registerTermsRoutes } from "./modules/terms/terms.routes.js";
import { registerTextTranslationRoutes } from "./modules/translation/text-translation.routes.js";
import { registerVoiceProfileRoutes } from "./modules/voice-profiles/voice-profiles.routes.js";
import { registerVoiceIdentityRoutes } from "./modules/voice-identities/voice-identities.routes.js";
import { registerIngressRoutes } from "./modules/ingress/ingress.routes.js";
import { registerPlatformTelemetryHooks } from "./infrastructure/observability/platform-telemetry.js";

export async function buildApp(dependencies: {
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
} = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: logRedactionPaths,
        censor: "[REDACTED]",
      },
      formatters: {
        log: redactLogObject,
      },
      serializers: {
        req: serializeRequest,
        res: serializeResponse,
      },
    },
  });
  const enterpriseRepositoryRuntime = dependencies.enterpriseRepositoryRuntime ??
    legacyEnterpriseRepositoryRuntime;
  const tenantRouteService = dependencies.tenantRouteService ??
    createEnvironmentTenantRouteService();
  const auditExportArtifactStore = dependencies.auditExportArtifactStore ??
    createEnvironmentAuditExportArtifactStore();
  const providerReadinessService = dependencies.providerReadinessService ??
    createEnterpriseProviderReadinessService();
  const supportInboundTickets = dependencies.enterpriseSupportInboundTicketService ??
    createEnvironmentEnterpriseSupportInboundTicketService();
  app.addHook("onClose", () => auditExportArtifactStore.close());
  registerPlatformTelemetryHooks(app);
  await app.register(cors, { origin: true });
  await registerAccountRoutes(app);
  await registerAgentCallRoutes(app);
  await registerHealthRoutes(app);
  registerIngressRoutes(app);
  await registerModelRoutes(app);
  await registerBillingRoutes(app);
  await registerCallLinkRoutes(app);
  await registerDiagnosticsRoutes(app);
  await registerEnterpriseTenantRoutes(
    app,
    dependencies.tenantProvisioner ?? createEnvironmentTenantProvisioner(),
    tenantRouteService,
    dependencies.tenantLifecycleExecutor ??
      createEnvironmentTenantLifecycleExecutor(),
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseCommunicationPolicyRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseUsageBudgetRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseUsageAccountingRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseBillingEntitlementRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseKnowledgeRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseTerminologyRoutes(
    app, tenantRouteService, enterpriseRepositoryRuntime,
  );
  await registerEnterpriseScriptTemplateRoutes(
    app, tenantRouteService, enterpriseRepositoryRuntime,
  );
  await registerEnterpriseProviderReadinessRoutes(
    app,
    providerReadinessService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseAuditRoutes(
    app,
    dependencies.auditCursorService ??
      createEnvironmentEnterpriseAuditCursorService(),
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseObservabilityRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
  );
  await registerEnterpriseAuditExportRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
    auditExportArtifactStore,
  );
  await registerEnterpriseMeetingRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
    dependencies.enterpriseMeetingInviteTokenService ??
      createEnvironmentEnterpriseMeetingInviteTokenService(),
    dependencies.enterpriseMeetingTranslationDispatchService ??
      createEnvironmentEnterpriseMeetingTranslationDispatchService(),
  );
  registerEnterpriseMeetingCalendarRoutes(
    app, tenantRouteService, enterpriseRepositoryRuntime, providerReadinessService,
  );
  registerEnterpriseSupportChannelRoutes(
    app, tenantRouteService, enterpriseRepositoryRuntime,
    providerReadinessService, supportInboundTickets,
  );
  registerEnterpriseSupportRagRoutes(
    app, tenantRouteService, enterpriseRepositoryRuntime,
  );
  registerEnterpriseMeetingScreenShareRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
    dependencies.enterpriseMeetingScreenShareProvider ??
      createEnvironmentEnterpriseMeetingScreenShareProvider(),
  );
  registerEnterpriseMeetingMaterialRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
    dependencies.enterpriseMeetingMaterialProvider ??
      createEnvironmentEnterpriseMeetingMaterialProvider(),
  );
  registerEnterpriseMeetingScreenOcrRoutes(
    app,
    tenantRouteService,
    enterpriseRepositoryRuntime,
    dependencies.enterpriseMeetingScreenOcrDispatch ??
      createEnvironmentEnterpriseMeetingScreenOcrDispatchService(),
  );
  await registerPlansRoutes(app);
  await registerRealtimeRoutes(app);
  await registerSessionsRoutes(app);
  await registerTermsRoutes(app);
  await registerTextTranslationRoutes(app);
  await registerVoiceProfileRoutes(app);
  await registerVoiceIdentityRoutes(app);
  return app;
}

function serializeRequest(request: {
  method?: string;
  url?: string;
  headers?: { host?: string };
  hostname?: string;
  ip?: string;
  remoteAddress?: string;
  raw?: {
    method?: string;
    url?: string;
    headers?: { host?: string };
    socket?: { remoteAddress?: string };
  };
}) {
  const url = request.url ?? request.raw?.url;
  return {
    method: request.method ?? request.raw?.method,
    url: url ? redactLogString(url) : undefined,
    host:
      request.headers?.host ?? request.hostname ?? request.raw?.headers?.host,
    remoteAddress:
      request.remoteAddress ?? request.ip ?? request.raw?.socket?.remoteAddress,
  };
}

function serializeResponse(response: {
  statusCode?: number;
  raw?: { statusCode?: number };
}) {
  return {
    statusCode: response.statusCode ?? response.raw?.statusCode,
  };
}
