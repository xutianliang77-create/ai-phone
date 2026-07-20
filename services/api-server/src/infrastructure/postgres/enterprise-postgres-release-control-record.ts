import type { EnterpriseReleaseControlRecord } from
  "../../modules/enterprise/enterprise-release-control.js";
import { isEnterpriseReleaseCapability, validCircuitState } from
  "../../modules/enterprise/enterprise-release-control.js";

export interface EnterpriseReleaseControlRow extends Record<string, unknown> {
  tenant_id: unknown;
  capability: unknown;
  enabled: unknown;
  kill_switch_active: unknown;
  circuit_state: unknown;
  consecutive_failures: unknown;
  failure_threshold: unknown;
  owner: unknown;
  rollout_expires_at: unknown;
  last_failure_at: unknown;
  opened_at: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
}

export function releaseControlRecord(
  row: EnterpriseReleaseControlRow,
  tenantId: string,
): EnterpriseReleaseControlRecord {
  if (row.tenant_id !== tenantId || !isEnterpriseReleaseCapability(row.capability) ||
    typeof row.enabled !== "boolean" ||
    typeof row.kill_switch_active !== "boolean" ||
    !validCircuitState(row.circuit_state)) {
    throw new Error("Invalid enterprise release control row");
  }
  return {
    tenantId,
    capability: row.capability,
    enabled: row.enabled,
    killSwitchActive: row.kill_switch_active,
    circuitState: row.circuit_state,
    consecutiveFailures: integer(row.consecutive_failures),
    failureThreshold: integer(row.failure_threshold),
    owner: text(row.owner),
    rolloutExpiresAt: iso(row.rollout_expires_at),
    ...(row.last_failure_at ? { lastFailureAt: iso(row.last_failure_at) } : {}),
    ...(row.opened_at ? { openedAt: iso(row.opened_at) } : {}),
    version: integer(row.version),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function releaseControlSnapshot(
  control: EnterpriseReleaseControlRecord,
) {
  return {
    enabled: control.enabled,
    killSwitchActive: control.killSwitchActive,
    circuitState: control.circuitState,
    consecutiveFailures: control.consecutiveFailures,
    failureThreshold: control.failureThreshold,
    owner: control.owner,
    rolloutExpiresAt: control.rolloutExpiresAt,
    version: control.version,
  };
}

function text(value: unknown) {
  if (typeof value !== "string" || !value) {
    throw new Error("Invalid enterprise release control text");
  }
  return value;
}
function integer(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid enterprise release control integer");
  }
  return parsed;
}
function iso(value: unknown) {
  const parsed = typeof value === "string" ? value :
    value instanceof Date ? value.toISOString() : "";
  if (!parsed || !Number.isFinite(Date.parse(parsed))) {
    throw new Error("Invalid enterprise release control timestamp");
  }
  return parsed;
}
