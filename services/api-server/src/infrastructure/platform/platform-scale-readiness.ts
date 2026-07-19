import { getPlatformTelemetryReadiness } from "../observability/platform-telemetry.js";
import { getPlatformRoutingReadiness } from "./platform-session-routing.js";
import { postgresPrimaryCutoverAuthorization } from
  "../storage/repository-runtime.js";

export function getPlatformScaleReadiness() {
  const enabled = process.env.PLATFORM_MULTI_NODE_ENABLED === "true";
  const storageDriver = process.env.API_STORAGE_DRIVER?.trim().toLowerCase() || "json";
  const region = process.env.PLATFORM_REGION?.trim();
  const cellId = process.env.PLATFORM_CELL_ID?.trim();
  const topologyStatus = process.env.PLATFORM_TOPOLOGY_STATUS?.trim() ||
    "candidate_unverified";
  const targetConcurrentSessions = integer(
    process.env.PLATFORM_TARGET_CONCURRENT_SESSIONS,
    100,
  );
  const telemetry = getPlatformTelemetryReadiness();
  const routing = getPlatformRoutingReadiness();
  const issues = enabled ? [
    ...(storageDriver === "postgres"
      ? []
      : ["Multi-node mode requires API_STORAGE_DRIVER=postgres"]),
    ...(primaryPostgresRepositorySupported()
      ? []
      : ["PostgreSQL is shadow-only; the primary Repository cutover is incomplete"]),
    ...(region ? [] : ["PLATFORM_REGION is required"]),
    ...(cellId ? [] : ["PLATFORM_CELL_ID is required"]),
    ...(topologyStatus === "verified"
      ? []
      : ["Platform topology is not verified"]),
    ...(targetConcurrentSessions >= 100
      ? []
      : ["PLATFORM_TARGET_CONCURRENT_SESSIONS must be at least 100"]),
    ...(telemetry.status === "ready"
      ? []
      : ["Multi-node mode requires ready OpenTelemetry export"]),
    ...routing.issues,
  ] : [];
  return {
    status: !enabled ? "disabled" as const
      : issues.length === 0 ? "ready" as const : "not_ready" as const,
    enabled,
    storageDriver,
    primaryPostgresRepository: primaryPostgresRepositorySupported()
      ? "supported" as const
      : "shadow_only" as const,
    region,
    cellId,
    topologyStatus,
    targetConcurrentSessions,
    telemetry: telemetry.status,
    routing,
    issues,
  };
}

export function assertPlatformScaleStartup() {
  const readiness = getPlatformScaleReadiness();
  if (readiness.enabled && readiness.status !== "ready") {
    throw new Error(`Multi-node startup refused: ${readiness.issues.join("; ")}`);
  }
  return readiness;
}

function primaryPostgresRepositorySupported() {
  return postgresPrimaryCutoverAuthorization.authorized;
}

function integer(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
