import { describe, expect, it } from "vitest";
import type { EnterpriseReleaseCapability } from "@translation/contracts";
import { enterpriseMemberRoles, enterpriseScopes } from "@translation/contracts";
import { hasEnterpriseScope } from "./enterprise-rbac.js";
import {
  evaluateEnterpriseReleaseControl,
  type EnterpriseReleaseControlRecord,
} from "./enterprise-release-control.js";

const capability: EnterpriseReleaseCapability = "support.agent";
const now = "2026-07-20T10:00:00.000Z";

describe("enterprise release control policy", () => {
  it.each([
    [null, false, "control_missing"],
    [control({ enabled: false }), false, "rollout_disabled"],
    [control({ rolloutExpiresAt: now }), false, "rollout_expired"],
    [control({ killSwitchActive: true }), false, "kill_switch_active"],
    [control({ circuitState: "open", openedAt: now }), false, "circuit_open"],
    [control({ circuitState: "half_open", openedAt: now }), false, "probe_required"],
    [control(), true, "allowed"],
  ] as const)("fails closed for %#", (record, allowed, reason) => {
    expect(evaluateEnterpriseReleaseControl(record, capability, now)).toMatchObject({
      capability, allowed, reason,
    });
  });

  it("allows only a dedicated probe through half-open", () => {
    const record = control({ circuitState: "half_open", openedAt: now });
    expect(evaluateEnterpriseReleaseControl(
      record, capability, now, true,
    )).toMatchObject({ allowed: true, reason: "allowed" });
  });

  it.each(enterpriseMemberRoles)(
    "allows %s to read tenant status without granting mutation authority",
    (role) => {
      expect(hasEnterpriseScope(role, "tenant:read")).toBe(true);
      expect(enterpriseScopes).not.toContain("release:write");
    },
  );
});

function control(
  overrides: Partial<EnterpriseReleaseControlRecord> = {},
): EnterpriseReleaseControlRecord {
  return {
    tenantId: "00000000-0000-4000-8000-000000000001",
    capability,
    enabled: true,
    killSwitchActive: false,
    circuitState: "closed",
    consecutiveFailures: 0,
    failureThreshold: 3,
    owner: "sre-oncall",
    rolloutExpiresAt: "2026-07-21T10:00:00.000Z",
    version: 1,
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
    ...overrides,
  };
}
