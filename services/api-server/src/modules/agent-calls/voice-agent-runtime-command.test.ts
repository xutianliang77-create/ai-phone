import { describe, expect, it } from "vitest";
import { resolveVoiceAgentRuntimeCommand } from
  "./voice-agent-runtime-command.js";

describe("Voice Agent heartbeat command", () => {
  it("replays persisted pause until the same task is resumed", () => {
    expect(resolveVoiceAgentRuntimeCommand({
      draft: { status: "in_progress", agentControlState: "paused" },
      handoffTimedOut: false,
    })).toBe("pause");
    expect(resolveVoiceAgentRuntimeCommand({
      draft: { status: "in_progress", agentControlState: "running" },
      handoffTimedOut: false,
    })).toBe("continue");
  });

  it("gives cancel and takeover precedence over pause", () => {
    expect(resolveVoiceAgentRuntimeCommand({
      draft: { status: "cancelled", agentControlState: "paused" },
      handoffTimedOut: false,
    })).toBe("cancel");
    expect(resolveVoiceAgentRuntimeCommand({
      draft: { status: "takeover_requested", agentControlState: "paused" },
      handoffTimedOut: false,
    })).toBe("takeover");
    expect(resolveVoiceAgentRuntimeCommand({
      draft: { status: "in_progress", agentControlState: "paused" },
      handoffTimedOut: true,
    })).toBe("cancel");
  });
});
