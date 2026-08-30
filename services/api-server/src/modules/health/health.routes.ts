import type { FastifyInstance } from "fastify";
import { loadEnv } from "../../config/env.js";
import { getAccountDeploymentReadiness } from "../account/account-readiness.js";
import { getSmsDeploymentReadiness } from "../account/sms-provider.js";
import { getPaymentDeploymentReadiness } from "../billing/payment-readiness.js";
import { getPstnReadiness } from "../calls/pstn-readiness.js";
import { getCallRoomReadiness } from "../call-links/call-room-readiness.js";
import { getDiagnosticsDeploymentReadiness } from "../diagnostics/diagnostics-alerting.js";
import { diagnosticsAdminStatus } from "../diagnostics/diagnostics-auth.js";
import { sessionReviewProviderStatus } from "../sessions/session-review.js";
import { getReleaseMaterialsReadiness } from "./release-materials-readiness.js";
import { getEnterpriseReleaseMaterialsReadiness } from
  "./enterprise-release-materials-readiness.js";
import { getReleaseReadiness } from "./release-readiness.js";
import { getRepositoryStorageStatus } from
  "../../infrastructure/storage/repository-runtime.js";
import { getLiveKitDispatchReadiness } from "../worker-dispatches/livekit-dispatch-readiness.js";
import { getLiveKitEgressReadiness } from "../recordings/livekit-egress-readiness.js";
import { getPostgresProjectionReadiness } from "../../infrastructure/storage/postgres-projection-status.js";
import { getAgentAssistReadiness } from "../agent-calls/agent-assist-provider.js";
import { getAutonomousAgentReadiness } from "../agent-calls/autonomous-agent-policy.js";
import { getLiveKitIngressReadiness } from "../ingress/livekit-ingress-readiness.js";
import { getPlatformScaleReadiness } from "../../infrastructure/platform/platform-scale-readiness.js";
import { getPlatformTelemetryReadiness } from "../../infrastructure/observability/platform-telemetry.js";
import { getVoiceAgentRuntimeReadiness } from
  "../agent-calls/voice-agent-runtime-readiness.js";
import { getAgentConsultReadiness } from
  "../agent-calls/agent-consult-readiness.js";
import type { EnterpriseControlPlaneAvailabilityService } from
  "../enterprise/enterprise-control-plane-availability.js";

export async function registerHealthRoutes(
  app: FastifyInstance,
  controlPlaneAvailability: EnterpriseControlPlaneAvailabilityService,
) {
  app.get("/health", async () => {
    const env = loadEnv();
    const accountReadiness = getAccountDeploymentReadiness();
    const paymentReadiness = getPaymentDeploymentReadiness();
    const callRoomReadiness = getCallRoomReadiness();
    const pstnReadiness = getPstnReadiness();
    const smsReadiness = getSmsDeploymentReadiness();
    const diagnosticsReadiness = await getDiagnosticsDeploymentReadiness();
    const releaseMaterialsReadiness = getReleaseMaterialsReadiness();
    const enterpriseReleaseMaterialsReadiness =
      getEnterpriseReleaseMaterialsReadiness();
    const sessionReview = sessionReviewProviderStatus();
    const workerDispatchReadiness = getLiveKitDispatchReadiness();
    const egressReadiness = getLiveKitEgressReadiness();
    const postgresProjectionReadiness = getPostgresProjectionReadiness();
    const agentAssistReadiness = getAgentAssistReadiness();
    const autonomousAgentReadiness = getAutonomousAgentReadiness();
    const ingressReadiness = getLiveKitIngressReadiness();
    const platformScaleReadiness = getPlatformScaleReadiness();
    const telemetryReadiness = getPlatformTelemetryReadiness();
    const voiceAgentRuntimeReadiness = getVoiceAgentRuntimeReadiness();
    const agentConsultReadiness = getAgentConsultReadiness();
    const controlPlaneHaReadiness = await controlPlaneAvailability.status();
    return {
      status: "ok",
      service: "api-server",
      version: "0.1.0",
      realtimeWsEndpoint: env.realtimeWsEndpoint,
      regionEdition: env.regionEdition,
      dataRegion: env.dataRegion,
      callProviderPolicy: env.callProviderPolicy,
      complianceProfile: env.complianceProfile,
      storage: getRepositoryStorageStatus(),
      diagnostics: {
        appErrorReporting: "enabled",
        appErrorEndpoint: "/diagnostics/app-errors",
        adminQuery: diagnosticsAdminStatus(),
        adminEndpoint: "/diagnostics/app-errors",
        summaryEndpoint: "/diagnostics/app-errors/summary",
        alertEndpoint: "/diagnostics/app-errors/alert-state",
        alertTestEndpoint: "/diagnostics/app-errors/alert-test",
        onCall: diagnosticsReadiness.onCall,
        webhook: diagnosticsReadiness.webhook,
        monitoringMode: "self_hosted",
        retentionLimit: 200,
        redaction: "enabled",
      },
      accountReadiness,
      paymentReadiness,
      callRoomReadiness,
      pstnReadiness,
      smsReadiness,
      sessionReview,
      workerDispatchReadiness,
      egressReadiness,
      postgresProjectionReadiness,
      agentAssistReadiness,
      autonomousAgentReadiness,
      voiceAgentRuntimeReadiness,
      agentConsultReadiness,
      ingressReadiness,
      platformScaleReadiness,
      telemetryReadiness,
      diagnosticsReadiness,
      releaseMaterialsReadiness,
      enterpriseReleaseMaterialsReadiness,
      controlPlaneHaReadiness,
    };
  });

  app.get("/health/ready", async (_request, reply) => {
    const paymentReadiness = getPaymentDeploymentReadiness();
    const statusCode = paymentReadiness.status === "ready" ? 200 : 503;
    return reply.status(statusCode).send({
      status: paymentReadiness.status,
      service: "api-server",
      paymentReadiness,
    });
  });

  app.get("/health/release-ready", async (_request, reply) => {
    const releaseReadiness = await getReleaseReadiness();
    const controlPlaneHaReadiness = await controlPlaneAvailability.status();
    const issues = [...new Set([
      ...releaseReadiness.issues,
      ...(controlPlaneHaReadiness.status === "ready"
        ? []
        : controlPlaneHaReadiness.issues),
    ])];
    const status = issues.length === 0 ? "ready" as const : "not_ready" as const;
    return reply.status(status === "ready" ? 200 : 503).send({
      ...releaseReadiness,
      status,
      issues,
      controlPlaneHaReadiness,
    });
  });
}
