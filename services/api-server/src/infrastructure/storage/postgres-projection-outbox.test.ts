import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEmptyStoreSnapshot } from "./json-store.js";
import {
  appendPostgresProjectionEvents,
  postgresProjectionSnapshotRecords,
} from "./postgres-projection-outbox.js";

describe("PostgreSQL projection outbox phone safety", () => {
  const previous = {
    enabled: process.env.POSTGRES_PROJECTION_ENABLED,
    active: process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID,
    keys: process.env.AGENT_PHONE_REFERENCE_KEYS_JSON,
  };

  beforeEach(() => {
    process.env.POSTGRES_PROJECTION_ENABLED = "true";
    process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID = "projection-v1";
    process.env.AGENT_PHONE_REFERENCE_KEYS_JSON = JSON.stringify({
      "projection-v1": Buffer.alloc(32, 9).toString("base64url"),
    });
  });

  afterEach(() => {
    restore("POSTGRES_PROJECTION_ENABLED", previous.enabled);
    restore("AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID", previous.active);
    restore("AGENT_PHONE_REFERENCE_KEYS_JSON", previous.keys);
  });

  it("never appends Agent phone plaintext to the projection outbox", () => {
    const before = createEmptyStoreSnapshot();
    const after = structuredClone(before);
    after.agentCallDrafts.push(draft());
    appendPostgresProjectionEvents(before, after);
    const event = after.postgresProjectionEvents.find(
      (candidate) => candidate.namespace === "agentCallDrafts",
    );
    expect(event?.payload).toMatchObject({
      id: "draft-1",
      targetPhoneReference: expect.stringMatching(/^aph1\.projection-v1\./),
    });
    expect(JSON.stringify(event)).not.toContain("13800138000");
  });

  it("never exposes Agent phone plaintext in offline snapshot records", () => {
    const snapshot = createEmptyStoreSnapshot();
    snapshot.agentCallDrafts.push(draft());
    const record = postgresProjectionSnapshotRecords(snapshot).find(
      (candidate) => candidate.namespace === "agentCallDrafts",
    );
    expect(JSON.stringify(record)).not.toContain("13800138000");
    expect(record?.payload).toMatchObject({
      targetPhoneReference: expect.stringMatching(/^aph1\.projection-v1\./),
    });
  });

  it("fails closed instead of emitting plaintext without the keyring", () => {
    delete process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID;
    delete process.env.AGENT_PHONE_REFERENCE_KEYS_JSON;
    const snapshot = createEmptyStoreSnapshot();
    snapshot.agentCallDrafts.push(draft());
    expect(() => postgresProjectionSnapshotRecords(snapshot))
      .toThrow(/active key ID is not configured/);
  });
});

function draft() {
  return {
    id: "draft-1", userId: "user-1", scenario: "booking" as const,
    status: "draft" as const, objective: "book", suggestedScript: "book",
    language: "zh" as const, riskLevel: "low" as const, riskReasons: [],
    targetPhone: "13800138000", createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
