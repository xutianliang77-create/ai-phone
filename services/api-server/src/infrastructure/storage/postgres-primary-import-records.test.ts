import { describe, expect, it } from "vitest";
import { createEmptyStoreSnapshot } from "./json-store.js";
import { postgresPrimarySnapshotRecords } from "./postgres-primary-import-records.js";

describe("PostgreSQL primary import records", () => {
  it("creates deterministic usage primary records from legacy maps", () => {
    const snapshot = createEmptyStoreSnapshot();
    snapshot.usagePlanCodes["user-1"] = "pro";
    snapshot.usageBalances["user-1"] = 5900;
    const first = postgresPrimarySnapshotRecords(snapshot);
    const second = postgresPrimarySnapshotRecords(snapshot);
    expect(first).toEqual(second);
    expect(first.find((record) =>
      record.namespace === "usageAccounts" && record.recordKey === "user-1"
    )?.payload).toEqual({
      userId: "user-1",
      planCode: "pro",
      monthlySeconds: 6000,
      remainingSeconds: 5900,
      version: 1,
      updatedAt: "1970-01-01T00:00:00.000Z",
    });
  });

  it("backfills immutable request hashes for legacy ledger and hold rows", () => {
    const snapshot = createEmptyStoreSnapshot();
    snapshot.usageHolds.push({
      id: "hold-1", userId: "user-1", seconds: 60, status: "active",
      createdAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-17T01:00:00.000Z",
    });
    snapshot.billingLedger.push({
      id: "ledger-1", userId: "user-1", type: "usage", source: "system",
      deltaSeconds: -60, balanceAfter: 240,
      createdAt: "2026-07-17T00:01:00.000Z",
    });
    const records = postgresPrimarySnapshotRecords(snapshot);
    expect(records.find((record) => record.recordKey === "hold-1")?.payload)
      .toMatchObject({ version: 1, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(records.find((record) => record.recordKey === "ledger-1")?.payload)
      .toMatchObject({ requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("backfills Agent request and handoff idempotency metadata", () => {
    const snapshot = createEmptyStoreSnapshot();
    snapshot.agentRuns.push({
      id: "run-1", taskId: "task-1", attempt: 1, mode: "assist",
      status: "ready", policyVersion: "policy-1",
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    snapshot.agentHandoffs.push({
      id: "handoff-1", runId: "run-1", reason: "operator",
      redactedSummary: "operator requested", target: "operator",
      status: "requested", requestedAt: "2026-07-17T00:00:00.000Z",
    });
    const records = postgresPrimarySnapshotRecords(snapshot);
    expect(records.find((record) => record.recordKey === "run-1")?.payload)
      .toMatchObject({ requestHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(records.find((record) => record.recordKey === "handoff-1")?.payload)
      .toMatchObject({
        idempotencyKey: "import:handoff-1",
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
  });
});
