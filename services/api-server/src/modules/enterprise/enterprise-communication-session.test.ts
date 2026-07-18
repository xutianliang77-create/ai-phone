import { describe, expect, it } from "vitest";
import {
  evaluateEnterpriseCommunicationEvent,
  type EnterpriseCommunicationBindingRecord,
  type EnterpriseCommunicationStatus,
} from "./enterprise-communication-session.js";

describe("enterprise communication session state machine", () => {
  it.each([
    ["provisioning", "dispatching"],
    ["dispatching", "ready"],
    ["ready", "active"],
    ["active", "degraded"],
    ["degraded", "captions_only"],
    ["captions_only", "half_duplex"],
    ["half_duplex", "active"],
    ["active", "draining"],
    ["draining", "ended"],
  ] as const)("accepts %s -> %s", (previous, requested) => {
    expect(evaluateEnterpriseCommunicationEvent(record({ status: previous }), {
      status: requested,
      routeEpoch: 7,
      generation: 2,
      sequence: 11,
    })).toEqual({ status: "apply", nextStatus: requested });
  });

  it("rejects stale route, generation and replayed events", () => {
    expect(decide({ routeEpoch: 6 })).toEqual({ status: "stale_route" });
    expect(decide({ generation: 1 })).toEqual({ status: "stale_generation" });
    expect(decide({ sequence: 10 })).toEqual({ status: "stale_event" });
  });

  it("allows a restarted generation to resume with a lower sequence", () => {
    expect(decide({ generation: 3, sequence: 1 })).toEqual({
      status: "apply",
      nextStatus: "active",
    });
  });

  it("keeps terminal sessions terminal and rejects backwards transitions", () => {
    expect(evaluateEnterpriseCommunicationEvent(record({ status: "ended" }), {
      status: "active",
      routeEpoch: 7,
      generation: 2,
      sequence: 11,
    })).toEqual({ status: "terminal" });
    expect(evaluateEnterpriseCommunicationEvent(record({ status: "ready" }), {
      status: "provisioning",
      routeEpoch: 7,
      generation: 2,
      sequence: 11,
    })).toEqual({ status: "invalid_transition" });
  });
});

function decide(overrides: Partial<{
  status: EnterpriseCommunicationStatus;
  routeEpoch: number;
  generation: number;
  sequence: number;
}> = {}) {
  return evaluateEnterpriseCommunicationEvent(record(), {
    status: "active",
    routeEpoch: 7,
    generation: 2,
    sequence: 11,
    ...overrides,
  });
}

function record(
  overrides: Partial<EnterpriseCommunicationBindingRecord> = {},
): EnterpriseCommunicationBindingRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002",
    communicationSessionId: "session-a",
    kind: "meeting",
    businessId: "00000000-0000-4000-8000-000000000003",
    status: "active",
    homeRegion: "cn",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    policyVersion: "policy-v1",
    entitlementVersion: "entitlement-v1",
    generation: 2,
    lastEventSequence: 10,
    startedAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:01.000Z",
    version: 3,
    ...overrides,
  };
}
