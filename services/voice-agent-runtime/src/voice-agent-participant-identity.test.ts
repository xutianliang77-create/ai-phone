import { describe, expect, it } from "vitest";
import { voiceAgentParticipantIdentity } from
  "./voice-agent-participant-identity.js";

describe("Voice Agent participant identity", () => {
  it("is deterministic, session-bound, and collision-resistant", () => {
    const base = {
      sessionId: "agent_session_29b229db0ab9454088fc55b265b21dcd",
      generation: 3,
    };
    const first = voiceAgentParticipantIdentity({
      ...base,
      callId: "agent_session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    const second = voiceAgentParticipantIdentity({
      ...base,
      callId: "agent_session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(first).toBe(voiceAgentParticipantIdentity({
      ...base,
      callId: "agent_session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }));
    expect(first).not.toBe(second);
    expect(first).toMatch(
      /^agent_session_29b229db0ab9454088fc55b265b21dcd:worker:voice_agent_[a-f0-9]{24}_g3$/,
    );
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(256);
  });

  it("changes across generations and rejects an identity over the API bound", () => {
    const input = {
      sessionId: "session-1",
      callId: "call-1",
    };
    expect(voiceAgentParticipantIdentity({ ...input, generation: 1 }))
      .not.toBe(voiceAgentParticipantIdentity({ ...input, generation: 2 }));
    expect(() => voiceAgentParticipantIdentity({
      sessionId: "s".repeat(230),
      callId: "call-1",
      generation: 1,
    })).toThrow("participant identity is too long");
  });
});
