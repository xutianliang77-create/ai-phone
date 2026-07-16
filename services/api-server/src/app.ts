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
  createEnvironmentTenantLifecycleExecutor,
  type TenantLifecycleExecutor,
} from "./modules/enterprise/enterprise-tenant-lifecycle-executor.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerModelRoutes } from "./modules/models/models.routes.js";
import { registerPlansRoutes } from "./modules/plans/plans.routes.js";
import { registerRealtimeRoutes } from "./modules/realtime/realtime.routes.js";
import { registerSessionsRoutes } from "./modules/sessions/sessions.routes.js";
import { registerTermsRoutes } from "./modules/terms/terms.routes.js";
import { registerTextTranslationRoutes } from "./modules/translation/text-translation.routes.js";
import { registerVoiceProfileRoutes } from "./modules/voice-profiles/voice-profiles.routes.js";
import { registerVoiceIdentityRoutes } from "./modules/voice-identities/voice-identities.routes.js";

export async function buildApp(dependencies: {
  tenantProvisioner?: TenantProvisioner;
  tenantRouteService?: TenantRouteService;
  tenantLifecycleExecutor?: TenantLifecycleExecutor;
  providerReadinessService?: EnterpriseProviderReadinessService;
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
  await app.register(cors, { origin: true });
  await registerAccountRoutes(app);
  await registerAgentCallRoutes(app);
  await registerHealthRoutes(app);
  await registerModelRoutes(app);
  await registerBillingRoutes(app);
  await registerCallLinkRoutes(app);
  await registerDiagnosticsRoutes(app);
  await registerEnterpriseTenantRoutes(
    app,
    dependencies.tenantProvisioner ?? createEnvironmentTenantProvisioner(),
    dependencies.tenantRouteService ?? createEnvironmentTenantRouteService(),
    dependencies.tenantLifecycleExecutor ??
      createEnvironmentTenantLifecycleExecutor(),
  );
  await registerEnterpriseProviderReadinessRoutes(
    app,
    dependencies.providerReadinessService ??
      createEnterpriseProviderReadinessService(),
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
