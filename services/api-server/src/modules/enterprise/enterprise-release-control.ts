import {
  enterpriseReleaseCapabilities,
  type EnterpriseReleaseCapability,
  type EnterpriseReleaseCircuitState,
  type EnterpriseReleaseControlDto,
  type EnterpriseReleaseDecisionDto,
} from "@translation/contracts";

export interface EnterpriseReleaseControlRecord
  extends EnterpriseReleaseControlDto {
  tenantId: string;
  lastFailureAt?: string;
  openedAt?: string;
  createdAt: string;
}

export type EnterpriseReleaseControlAction =
  | { type: "set_rollout"; enabled: boolean }
  | { type: "set_kill_switch"; active: boolean }
  | { type: "begin_probe" };

export interface EnterpriseReleaseControlChange {
  tenantId: string;
  capability: EnterpriseReleaseCapability;
  expectedVersion: number;
  action: EnterpriseReleaseControlAction;
  owner: string;
  rolloutExpiresAt: string;
  failureThreshold: number;
  reason: string;
  actorId: string;
  traceId: string;
  operationId: string;
  now: string;
}

export interface EnterpriseReleaseOutcome {
  tenantId: string;
  capability: EnterpriseReleaseCapability;
  outcome: "success" | "failure";
  probe: boolean;
  actorId: string;
  traceId: string;
  operationId: string;
  now: string;
}

export function isEnterpriseReleaseCapability(
  value: unknown,
): value is EnterpriseReleaseCapability {
  return typeof value === "string" &&
    enterpriseReleaseCapabilities.includes(value as EnterpriseReleaseCapability);
}

export function evaluateEnterpriseReleaseControl(
  control: EnterpriseReleaseControlRecord | null,
  capability: EnterpriseReleaseCapability,
  now: string,
  probe = false,
): EnterpriseReleaseDecisionDto {
  if (!control) return missingDecision(capability);
  const base = {
    capability: control.capability,
    circuitState: control.circuitState,
    version: control.version,
  };
  if (!control.enabled) {
    return { ...base, allowed: false, reason: "rollout_disabled" };
  }
  if (Date.parse(control.rolloutExpiresAt) <= Date.parse(now)) {
    return { ...base, allowed: false, reason: "rollout_expired" };
  }
  if (control.killSwitchActive) {
    return { ...base, allowed: false, reason: "kill_switch_active" };
  }
  if (control.circuitState === "open") {
    return { ...base, allowed: false, reason: "circuit_open" };
  }
  if (control.circuitState === "half_open" && !probe) {
    return { ...base, allowed: false, reason: "probe_required" };
  }
  return { ...base, allowed: true, reason: "allowed" };
}

export function validCircuitState(
  value: unknown,
): value is EnterpriseReleaseCircuitState {
  return value === "closed" || value === "open" || value === "half_open";
}

function missingDecision(
  capability: EnterpriseReleaseCapability,
): EnterpriseReleaseDecisionDto {
  return {
    capability,
    allowed: false,
    reason: "control_missing",
    circuitState: "unknown",
  };
}
