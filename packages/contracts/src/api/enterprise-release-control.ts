export const enterpriseReleaseCapabilities = [
  "meeting.screen_ocr",
  "support.agent",
  "support.write_tools",
  "marketing.pstn",
] as const;

export type EnterpriseReleaseCapability =
  (typeof enterpriseReleaseCapabilities)[number];

export type EnterpriseReleaseCircuitState = "closed" | "open" | "half_open";

export interface EnterpriseReleaseControlDto {
  capability: EnterpriseReleaseCapability;
  enabled: boolean;
  killSwitchActive: boolean;
  circuitState: EnterpriseReleaseCircuitState;
  consecutiveFailures: number;
  failureThreshold: number;
  owner: string;
  rolloutExpiresAt: string;
  version: number;
  updatedAt: string;
}

export type EnterpriseReleaseDecisionReason =
  | "allowed"
  | "control_missing"
  | "rollout_disabled"
  | "rollout_expired"
  | "kill_switch_active"
  | "circuit_open"
  | "probe_required";

export interface EnterpriseReleaseDecisionDto {
  capability: EnterpriseReleaseCapability;
  allowed: boolean;
  reason: EnterpriseReleaseDecisionReason;
  circuitState: EnterpriseReleaseCircuitState | "unknown";
  version?: number;
}
