import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCallRecord } from "./agent-call-record.js";
import { toAgentTaskPrimary } from "./postgres-agent-task-uow.js";
import { PostgresAgentTasksRepository } from "./postgres-agent-tasks.repository.js";

describe("PostgreSQL Agent task queries", () => {
  const previous = {
    active: process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID,
    keys: process.env.AGENT_PHONE_REFERENCE_KEYS_JSON,
  };

  beforeEach(() => {
    process.env.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID = "query-v1";
    process.env.AGENT_PHONE_REFERENCE_KEYS_JSON = JSON.stringify({
      "query-v1": Buffer.alloc(32, 5).toString("base64url"),
    });
  });

  afterEach(() => {
    restore("AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID", previous.active);
    restore("AGENT_PHONE_REFERENCE_KEYS_JSON", previous.keys);
  });

  it("lists tasks through the normalized owner index and hydrates the phone", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "draft-1", payload: primary() }],
    });
    const release = vi.fn();
    const repository = new PostgresAgentTasksRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as never);
    const tasks = await repository.listOwned("user-1", 25);
    expect(tasks[0]).toMatchObject({
      id: "draft-1", userId: "user-1", targetPhone: "13800138000",
    });
    expect(query.mock.calls[0]?.[0]).toContain("task.user_id = $1");
    expect(query.mock.calls[0]?.[1]).toEqual(["user-1", 25]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("binds call-reference lookup to the optional owner in SQL", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresAgentTasksRepository({
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
    } as never);
    expect(await repository.findByCallReference({
      userId: "user-1", callId: "call-1",
    })).toBeNull();
    expect(query.mock.calls[0]?.[0]).toContain("task.user_id = $3");
    expect(query.mock.calls[0]?.[1]).toEqual(["call-1", null, "user-1"]);
  });
});

function primary() {
  return toAgentTaskPrimary(task(), {
    version: 1, requestHash: "r".repeat(64), idempotencyKey: "draft:create:1",
  });
}

function task(): AgentCallRecord {
  return {
    id: "draft-1", userId: "user-1", scenario: "booking", status: "authorized",
    objective: "book", suggestedScript: "book it", targetPhone: "13800138000",
    language: "zh", riskLevel: "low", riskReasons: [],
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
