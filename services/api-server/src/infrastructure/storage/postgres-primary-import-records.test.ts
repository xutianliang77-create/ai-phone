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

  it("replaces Agent phone plaintext with a deterministic sealed reference", () => {
    const previousActive = process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID;
    const previousKeys = process.env.AGENT_PHONE_REFERENCE_KEYS_JSON;
    process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID = "import-v1";
    process.env.AGENT_PHONE_REFERENCE_KEYS_JSON = JSON.stringify({
      "import-v1": Buffer.alloc(32, 3).toString("base64url"),
    });
    try {
      const snapshot = createEmptyStoreSnapshot();
      snapshot.agentCallDrafts.push({
        id: "draft-1", userId: "user-1", scenario: "booking", status: "draft",
        objective: "book a table", suggestedScript: "book", language: "zh",
        riskLevel: "low", riskReasons: [], targetPhone: "13800138000",
        createdAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:00.000Z",
      });
      const first = postgresPrimarySnapshotRecords(snapshot);
      const second = postgresPrimarySnapshotRecords(snapshot);
      const payload = first.find((record) => record.namespace === "agentCallDrafts")
        ?.payload as Record<string, unknown>;
      expect(payload.targetPhone).toBeUndefined();
      expect(payload.targetPhoneReference).toMatch(/^aph1\.import-v1\./);
      expect(JSON.stringify(payload)).not.toContain("13800138000");
      expect(second).toEqual(first);
    } finally {
      restore("AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID", previousActive);
      restore("AGENT_PHONE_REFERENCE_KEYS_JSON", previousKeys);
    }
  });
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
