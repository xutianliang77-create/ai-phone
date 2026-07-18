import { describe, expect, it } from "vitest";
import {
  requireSessionUpdate,
  sessionCommand,
} from "./postgres-session-uow.js";
import type { SessionRecord } from "./session-record.js";

describe("PostgreSQL session unit of work", () => {
  it("binds a command to the communication session aggregate", () => {
    expect(sessionCommand({
      sessionId: "session-1",
      commandId: "command-1",
      commandType: "session.end",
      requestHash: "a".repeat(64),
    })).toEqual({
      commandId: "command-1",
      aggregateType: "communication_session",
      aggregateId: "session-1",
      commandType: "session.end",
      requestHash: "a".repeat(64),
    });
  });

  it("rejects an update that changes immutable ownership", () => {
    const current = session();
    expect(() => requireSessionUpdate(current, {
      ...current,
      userId: "other-user",
      version: 2,
    })).toThrow(/immutable fields/);
  });

  it("rejects a skipped aggregate version", () => {
    const current = session();
    expect(() => requireSessionUpdate(current, {
      ...current,
      version: 3,
    })).toThrow(/version changed illegally/);
  });
});

function session(): SessionRecord & { version: number } {
  return {
    id: "session-1",
    userId: "user-1",
    mode: "conversation",
    status: "active",
    consumedSeconds: 0,
    createdAt: "2026-07-17T00:00:00.000Z",
    version: 1,
    segments: [],
  };
}
