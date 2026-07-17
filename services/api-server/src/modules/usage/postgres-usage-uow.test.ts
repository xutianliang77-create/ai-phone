import { describe, expect, it } from "vitest";
import {
  requireLedgerEntry,
  requireUsageHold,
  usageBalance,
  usageCommand,
} from "./postgres-usage-uow.js";

describe("PostgreSQL usage unit of work", () => {
  it("binds session settlement commands to the session fence", () => {
    expect(usageCommand({
      aggregateType: "communication_session",
      aggregateId: "session-1",
      commandId: "settle-session-1",
      commandType: "usage.settle",
      requestHash: "a".repeat(64),
    })).toMatchObject({
      aggregateType: "communication_session",
      aggregateId: "session-1",
    });
  });

  it("computes availability after active holds", () => {
    expect(usageBalance({
      userId: "user-1",
      planCode: "free",
      monthlySeconds: 300,
      remainingSeconds: 240,
      version: 2,
      updatedAt: "2026-07-17T00:00:00.000Z",
    }, 90)).toMatchObject({
      heldSeconds: 90,
      availableSeconds: 150,
    });
  });

  it("rejects ledger rows without the command request hash", () => {
    expect(() => requireLedgerEntry({
      id: "ledger-1",
      userId: "user-1",
      type: "usage",
      source: "system",
      deltaSeconds: -10,
      balanceAfter: 290,
      createdAt: "2026-07-17T00:00:00.000Z",
    }, "ledger-1")).toThrow(/ledger entry/);
  });

  it("requires a positive hold version", () => {
    expect(() => requireUsageHold({
      id: "hold-1",
      userId: "user-1",
      seconds: 60,
      status: "active",
      requestHash: "a".repeat(64),
      version: 0,
      createdAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-17T01:00:00.000Z",
    }, "hold-1")).toThrow(/usage hold/);
  });
});
