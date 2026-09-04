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
import { registerAirDeviceCallRoutes } from
  "./modules/device-calls/air-device-call.routes.js";
import { registerAirDeviceTrackAdmissionRoutes } from
  "./modules/device-calls/air-device-track-admission.routes.js";
import { registerPlatformTelemetryHooks } from "./infrastructure/observability/platform-telemetry.js";
import { registerPlatformMetricsRoutes } from
  "./infrastructure/observability/platform-metrics.routes.js";
import { loadEnv } from "./config/env.js";
import { registerPublicEntryProtection } from
  "./infrastructure/security/public-entry-protection.js";
import type { PublicEntryRateLimiter } from
  "./infrastructure/security/public-entry-protection.js";

export interface BuildAppOptions {
  publicEntryRateLimiter?: PublicEntryRateLimiter;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const env = loadEnv();
  const app = Fastify({
    bodyLimit: env.apiBodyLimitBytes,
    trustProxy: env.trustProxyAddresses,
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
  registerPlatformTelemetryHooks(app);
  await app.register(cors, {
    origin: env.corsAllowedOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "authorization",
      "content-type",
      "idempotency-key",
      "x-device-id",
    ],
    strictPreflight: true,
    maxAge: 600,
  });
  registerPublicEntryProtection(app, env, options.publicEntryRateLimiter);
  registerPlatformMetricsRoutes(app);
  await registerAccountRoutes(app);
  await registerAgentCallRoutes(app);
  registerAirDeviceCallRoutes(app);
  registerAirDeviceTrackAdmissionRoutes(app);
  await registerHealthRoutes(app);
  registerIngressRoutes(app);
  await registerModelRoutes(app);
  await registerBillingRoutes(app);
  await registerCallLinkRoutes(app);
  await registerDiagnosticsRoutes(app);
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
