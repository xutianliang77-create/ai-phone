import { describe, expect, it } from "vitest";
import type { AgentCallRecord } from "./agent-call-record.js";
import { hasPersistedTakeoverBinding } from
  "./agent-call-takeover-binding.js";

const draft = {
  id: "draft-1",
  userId: "user-1",
  status: "takeover_requested",
  takeoverResolvedAt: "2026-08-13T10:00:00.000Z",
  takeoverParticipantIdentity: "call-1:host:host-1",
} as AgentCallRecord;

describe("Agent takeover persisted binding", () => {
  it("accepts only the exact resolved participant", () => {
    expect(hasPersistedTakeoverBinding(draft, "call-1:host:host-1")).toBe(true);
    expect(hasPersistedTakeoverBinding(draft, "call-1:host:host-2")).toBe(false);
  });

  it("rejects a response without durable resolution", () => {
    expect(hasPersistedTakeoverBinding({
      ...draft,
      takeoverResolvedAt: undefined,
    }, "call-1:host:host-1")).toBe(false);
    expect(hasPersistedTakeoverBinding(null, "call-1:host:host-1")).toBe(false);
  });
});
