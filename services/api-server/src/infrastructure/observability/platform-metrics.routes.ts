import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { renderRealtimePrometheusMetrics } from "./realtime-prometheus.js";

export function registerPlatformMetricsRoutes(app: FastifyInstance) {
  app.get("/metrics", async (request, reply) => {
    const expected = process.env.METRICS_BEARER_TOKEN?.trim() ?? "";
    if (!expected) {
      return reply.status(503).send({
        code: "metrics_not_configured",
        message: "Metrics bearer token is not configured",
      });
    }
    if (!validBearer(request.headers.authorization, expected)) {
      return reply.status(401).send({
        code: "metrics_unauthorized",
        message: "Metrics bearer token required",
      });
    }
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .send(renderRealtimePrometheusMetrics());
  });
}

export function getPlatformMetricsReadiness() {
  const tokenConfigured = Boolean(process.env.METRICS_BEARER_TOKEN?.trim());
  return {
    status: tokenConfigured ? "ready" : "not_ready",
    prometheusPath: "/metrics",
    tokenConfigured,
    rtcThresholds: "calibration_required",
  };
}

function validBearer(authorization: string | undefined, expected: string) {
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}
