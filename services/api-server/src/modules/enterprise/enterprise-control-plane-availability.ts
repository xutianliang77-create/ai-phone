import {
  createEnterprisePostgresPool,
  enterprisePostgresConnectionConfig,
  type EnterprisePostgresPool,
} from "../../infrastructure/postgres/enterprise-postgres-client.js";
import {
  getEnterpriseControlPlaneConfigReadiness,
  loadEnterpriseControlPlaneObserverConfig,
} from "../../infrastructure/postgres/enterprise-control-plane-config.js";
import { enterpriseControlPlaneStatus } from
  "../../infrastructure/postgres/enterprise-control-plane.repository.js";
import type { EnterpriseControlPlaneConfig } from
  "../../infrastructure/postgres/enterprise-control-plane-types.js";

export type EnterpriseControlPlaneLiveStatus = Awaited<ReturnType<
  typeof enterpriseControlPlaneStatus
>> | {
  status: "disabled" | "not_ready";
  issues: string[];
};

export interface EnterpriseControlPlaneAvailabilityService {
  status(): Promise<EnterpriseControlPlaneLiveStatus>;
  close(): Promise<void>;
}

export function createEnvironmentEnterpriseControlPlaneAvailability(options: {
  env?: NodeJS.ProcessEnv;
  createPool?: (
    config: ReturnType<typeof enterprisePostgresConnectionConfig>,
  ) => EnterprisePostgresPool;
  now?: () => number;
} = {}): EnterpriseControlPlaneAvailabilityService {
  const env = options.env ?? process.env;
  const configured = getEnterpriseControlPlaneConfigReadiness(env);
  if (configured.status !== "configured") {
    return fixedAvailability(configured.status, configured.issues);
  }
  let config: EnterpriseControlPlaneConfig;
  let pool: EnterprisePostgresPool;
  try {
    config = loadEnterpriseControlPlaneObserverConfig(env);
    pool = (options.createPool ?? createEnterprisePostgresPool)(
      enterprisePostgresConnectionConfig(env, "control_plane_observer"),
    );
  } catch (error) {
    return fixedAvailability("not_ready", [safeMessage(error)]);
  }
  const now = options.now ?? Date.now;
  let closed = false;
  let cached: { expiresAt: number; value: EnterpriseControlPlaneLiveStatus } |
    undefined;
  return {
    async status() {
      if (closed) return notReady("control_plane_status_closed");
      if (cached && cached.expiresAt > now()) return cached.value;
      let value: EnterpriseControlPlaneLiveStatus;
      try {
        value = await enterpriseControlPlaneStatus({
          pool: pool!,
          config: config!,
          traceId: `control-plane-live:${now()}`,
        });
      } catch {
        value = notReady("control_plane_status_unavailable");
      }
      cached = { expiresAt: now() + 1_000, value };
      return value;
    },
    async close() {
      if (closed) return;
      closed = true;
      await pool!.end();
    },
  };
}

export function fixedEnterpriseControlPlaneAvailability(
  value: EnterpriseControlPlaneLiveStatus,
): EnterpriseControlPlaneAvailabilityService {
  return { async status() { return value; }, async close() {} };
}

function fixedAvailability(
  status: "disabled" | "not_ready",
  issues: string[],
) {
  return fixedEnterpriseControlPlaneAvailability({ status, issues });
}

function notReady(issue: string): EnterpriseControlPlaneLiveStatus {
  return { status: "not_ready", issues: [issue] };
}

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED]")
    : "control_plane_configuration_invalid";
}
