import { describe, expect, it } from "vitest";
import {
  parseVoiceAgentControl,
  VoiceAgentControlInbox,
} from "./voice-agent-control.js";

describe("Voice Agent control codec", () => {
  it("accepts the generation-bound pause command", () => {
    const value = {
      version: 1,
      controlId: "control-1",
      callId: "call-1",
      generation: 3,
      command: "pause",
      issuedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T00:00:10.000Z",
    };

    expect(parseVoiceAgentControl(new TextEncoder().encode(JSON.stringify(value))))
      .toEqual(value);
  });

  it("rejects commands outside the frozen control contract", () => {
    const value = {
      version: 1,
      controlId: "control-1",
      callId: "call-1",
      generation: 3,
      command: "mute_carrier",
      issuedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T00:00:10.000Z",
    };

    expect(parseVoiceAgentControl(new TextEncoder().encode(JSON.stringify(value))))
      .toBeNull();
  });

  it("rejects stale, participant-authored, and replayed controls", () => {
    const inbox = new VoiceAgentControlInbox();
    const encoded = new TextEncoder().encode(JSON.stringify({
      version: 1,
      controlId: "control-1",
      callId: "call-1",
      generation: 3,
      command: "pause",
      issuedAt: "2026-08-13T00:00:00.000Z",
      expiresAt: "2026-08-13T00:00:10.000Z",
    }));
    const base = {
      data: encoded,
      hasParticipant: false,
      topic: "voice-agent.control.v1",
      callId: "call-1",
      generation: 3,
      nowMs: Date.parse("2026-08-13T00:00:01.000Z"),
    };
    expect(inbox.accept({ ...base, hasParticipant: true })).toBeNull();
    expect(inbox.accept(base)).toBe("pause");
    expect(inbox.accept(base)).toBeNull();
    expect(new VoiceAgentControlInbox().accept({
      ...base,
      nowMs: Date.parse("2026-08-13T00:00:11.000Z"),
    })).toBeNull();
  });
});
