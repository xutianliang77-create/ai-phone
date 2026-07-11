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
import { getReleaseReadiness } from "./release-readiness.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const env = loadEnv();
    const accountReadiness = getAccountDeploymentReadiness();
    const paymentReadiness = getPaymentDeploymentReadiness();
    const callRoomReadiness = getCallRoomReadiness();
    const pstnReadiness = getPstnReadiness();
    const smsReadiness = getSmsDeploymentReadiness();
    const diagnosticsReadiness = getDiagnosticsDeploymentReadiness();
    const releaseMaterialsReadiness = getReleaseMaterialsReadiness();
    const sessionReview = sessionReviewProviderStatus();
    return {
      status: "ok",
      service: "api-server",
      version: "0.1.0",
      realtimeWsEndpoint: env.realtimeWsEndpoint,
      regionEdition: env.regionEdition,
      dataRegion: env.dataRegion,
      callProviderPolicy: env.callProviderPolicy,
      complianceProfile: env.complianceProfile,
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
      diagnosticsReadiness,
      releaseMaterialsReadiness,
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
    const releaseReadiness = getReleaseReadiness();
    const statusCode = releaseReadiness.status === "ready" ? 200 : 503;
    return reply.status(statusCode).send(releaseReadiness);
  });
}
