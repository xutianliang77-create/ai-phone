import { describe, expect, it } from "vitest";
import { evaluateAgentCallStartPolicy } from "./agent-call-gray-policy.js";

describe("agent call gray policy", () => {
  it("allows starts when the hourly gate is explicitly disabled", () => {
    const previous = process.env.AGENT_CALL_RATE_LIMIT_PER_HOUR;
    process.env.AGENT_CALL_RATE_LIMIT_PER_HOUR = "0";
    try {
      expect(evaluateAgentCallStartPolicy({
        userId: "user-1",
        targetPhone: "13800138000",
        drafts: Array.from({ length: 5 }, (_, index) => ({
          userId: "user-1",
          queuedAt: new Date(Date.now() - index * 1_000).toISOString(),
        } as never)),
      })).toMatchObject({ allowed: true, rateLimitPerHour: 0 });
    } finally {
      if (previous === undefined) delete process.env.AGENT_CALL_RATE_LIMIT_PER_HOUR;
      else process.env.AGENT_CALL_RATE_LIMIT_PER_HOUR = previous;
    }
  });
});
