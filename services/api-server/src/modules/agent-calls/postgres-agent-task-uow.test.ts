import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentCallRecord } from "./agent-call-record.js";
import {
  hydrateAgentTask,
  requireAgentTaskPrimary,
  toAgentTaskPrimary,
} from "./postgres-agent-task-uow.js";

describe("PostgreSQL Agent task unit of work", () => {
  const previous = {
    active: process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID,
    keys: process.env.AGENT_PHONE_REFERENCE_KEYS_JSON,
  };

  beforeEach(() => {
    process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID = "task-v1";
    process.env.AGENT_PHONE_REFERENCE_KEYS_JSON = JSON.stringify({
      "task-v1": Buffer.alloc(32, 4).toString("base64url"),
    });
  });

  afterEach(() => {
    restore("AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID", previous.active);
    restore("AGENT_PHONE_REFERENCE_KEYS_JSON", previous.keys);
  });

  it("stores only a sealed phone reference and hydrates it for the owner path", () => {
    const record = task();
    const primary = toAgentTaskPrimary(record, {
      version: 1,
      requestHash: "r".repeat(64),
      idempotencyKey: "draft:create:1",
    });
    expect(primary.targetPhone).toBeUndefined();
    expect(primary.targetPhoneReference).toMatch(/^aph1\.task-v1\./);
    expect(JSON.stringify(primary)).not.toContain(record.targetPhone);
    expect(hydrateAgentTask(primary, record.id)).toEqual(record);
  });

  it("requires versioned request and owner metadata", () => {
    const primary = toAgentTaskPrimary(task(), {
      version: 1,
      requestHash: "r".repeat(64),
      idempotencyKey: "draft:create:1",
    });
    expect(() => requireAgentTaskPrimary({ ...primary, version: 0 }, primary.id))
      .toThrow(/Agent task/);
    expect(() => requireAgentTaskPrimary({ ...primary, userId: "" }, primary.id))
      .toThrow(/Agent task/);
  });
});

function task(): AgentCallRecord {
  return {
    id: "draft-1", userId: "user-1", scenario: "booking", status: "authorized",
    objective: "book a table", suggestedScript: "book it", targetPhone: "13800138000",
    language: "zh", riskLevel: "low", riskReasons: [], consentPromptVersion: "v1",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
