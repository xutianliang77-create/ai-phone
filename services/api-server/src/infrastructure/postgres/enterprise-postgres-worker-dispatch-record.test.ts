import { describe, expect, it } from "vitest";
import type {
  EnterpriseCommunicationBindingRecord,
} from "../../modules/enterprise/enterprise-communication-session.js";
import type {
  EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import {
  evaluateEnterpriseWorkerDispatchFence,
  type EnterpriseWorkerDispatchGrantRecord,
} from "./enterprise-postgres-worker-dispatch-record.js";

const now = new Date("2026-07-18T05:01:00.000Z");

describe("enterprise worker dispatch fence", () => {
  it.each([
    ["tenant", { tenantId: "00000000-0000-4000-8000-000000000099" },
      "tenant_mismatch"],
    ["session", { communicationSessionId: "other-session" }, "session_mismatch"],
    ["cell", { cellId: "cn-cell-02" }, "cell_mismatch"],
    ["route", { routeEpoch: 8 }, "stale_route"],
    ["generation", { generation: 4 }, "stale_generation"],
    ["capability", { capability: "voice_agent_runtime" },
      "capability_mismatch"],
    ["expiry", { expiresAt: "2026-07-18T05:01:00.000Z" }, "expired"],
  ])("rejects a mismatched %s fence", (_name, change, expected) => {
    expect(evaluateEnterpriseWorkerDispatchFence({
      payload: { ...payload(), ...change } as EnterpriseWorkerDispatchTicketPayload,
      grant: grant(),
      binding: binding(),
      workerCellId: "cn-cell-01",
      workerId: "worker-01",
      requireAccepted: true,
      now,
    })).toEqual({ status: expected });
  });

  it("rejects cancellation, unaccepted and expired worker leases", () => {
    expect(decide({ grant: { status: "cancelled" } })).toEqual({
      status: "cancelled",
    });
    expect(decide({ grant: { status: "issued" } })).toEqual({
      status: "not_accepted",
    });
    expect(decide({ grant: {
      leaseExpiresAt: "2026-07-18T05:01:00.000Z",
    } })).toEqual({ status: "lease_expired" });
  });

  it("authorizes only the accepted current worker lease", () => {
    expect(decide()).toEqual({ status: "authorized" });
    expect(decide({ workerId: "worker-02" })).toEqual({
      status: "lease_conflict",
    });
  });
});

function decide(input: {
  grant?: Partial<EnterpriseWorkerDispatchGrantRecord>;
  workerId?: string;
} = {}) {
  return evaluateEnterpriseWorkerDispatchFence({
    payload: payload(),
    grant: { ...grant(), ...input.grant },
    binding: binding(),
    workerCellId: "cn-cell-01",
    workerId: input.workerId ?? "worker-01",
    requireAccepted: true,
    now,
  });
}

function payload(): EnterpriseWorkerDispatchTicketPayload {
  return {
    v: 1,
    ticketId: "00000000-0000-4000-8000-000000000011",
    tenantId: "00000000-0000-4000-8000-000000000001",
    communicationSessionId: "enterprise-session-1",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    generation: 3,
    capability: "translation_runtime",
    issuedAt: "2026-07-18T05:00:00.000Z",
    expiresAt: "2026-07-18T05:05:00.000Z",
  };
}

function grant(): EnterpriseWorkerDispatchGrantRecord {
  return {
    id: payload().ticketId,
    tenantId: payload().tenantId,
    communicationSessionId: payload().communicationSessionId,
    dispatchId: "dispatch-1",
    capacityReservationId: "capacity-1",
    capability: "translation_runtime",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    generation: 3,
    status: "accepted",
    idempotencyKey: "dispatch-1",
    requestHash: "a".repeat(64),
    issuedAt: payload().issuedAt,
    expiresAt: payload().expiresAt,
    leaseOwner: "worker-01",
    leaseExpiresAt: "2026-07-18T05:02:00.000Z",
    acceptedAt: "2026-07-18T05:00:30.000Z",
    updatedAt: "2026-07-18T05:00:30.000Z",
    version: 2,
  };
}

function binding(): EnterpriseCommunicationBindingRecord {
  return {
    id: "00000000-0000-4000-8000-000000000012",
    tenantId: payload().tenantId,
    communicationSessionId: payload().communicationSessionId,
    kind: "meeting",
    businessId: "00000000-0000-4000-8000-000000000013",
    status: "active",
    homeRegion: "cn-north",
    cellId: "cn-cell-01",
    routeEpoch: 7,
    policyVersion: "policy-1",
    entitlementVersion: "entitlement-1",
    generation: 3,
    lastEventSequence: 9,
    startedAt: "2026-07-18T05:00:00.000Z",
    updatedAt: "2026-07-18T05:00:30.000Z",
    version: 4,
  };
}
