import { getStoreSnapshot } from "./json-store.js";
import {
  getPostgresProjectionConfig,
  getPostgresProjectionConfigIssues,
} from "./postgres-projection-config.js";

export type PostgresProjectionRuntimeState =
  | "disabled"
  | "starting"
  | "ready"
  | "degraded"
  | "stopped";

const runtime = {
  state: "disabled" as PostgresProjectionRuntimeState,
  appliedEvents: 0,
  failedEvents: 0,
  lastSuccessAt: undefined as string | undefined,
  lastErrorAt: undefined as string | undefined,
  lastErrorClass: undefined as string | undefined,
};

export function updatePostgresProjectionRuntime(
  update: Partial<typeof runtime>,
) {
  Object.assign(runtime, update);
}

export function recordPostgresProjectionSuccess(now = new Date()) {
  runtime.state = "ready";
  runtime.appliedEvents += 1;
  runtime.lastSuccessAt = now.toISOString();
  runtime.lastErrorClass = undefined;
}

export function recordPostgresProjectionFailure(error: unknown, now = new Date()) {
  runtime.state = "degraded";
  runtime.failedEvents += 1;
  runtime.lastErrorAt = now.toISOString();
  runtime.lastErrorClass = errorClass(error);
}

export function getPostgresProjectionReadiness() {
  const config = getPostgresProjectionConfig();
  const configIssues = getPostgresProjectionConfigIssues(config);
  const backlog = config.enabled
    ? getStoreSnapshot().postgresProjectionEvents.length : 0;
  const runtimeIssues = config.enabled && runtime.state !== "ready"
    ? [`PostgreSQL projection worker is ${runtime.state}`]
    : [];
  const issues = [...configIssues, ...runtimeIssues];
  return {
    status: !config.enabled
      ? (config.required ? "not_ready" : "disabled")
      : issues.length === 0 && runtime.state === "ready"
      ? "ready"
      : "not_ready",
    required: config.required,
    runtimeState: runtime.state,
    backlog,
    appliedEvents: runtime.appliedEvents,
    failedEvents: runtime.failedEvents,
    lastSuccessAt: runtime.lastSuccessAt,
    lastErrorAt: runtime.lastErrorAt,
    lastErrorClass: runtime.lastErrorClass,
    issues,
  };
}

function errorClass(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code ?? "postgres_error").slice(0, 80);
  }
  return error instanceof Error ? error.name.slice(0, 80) : "postgres_error";
}
