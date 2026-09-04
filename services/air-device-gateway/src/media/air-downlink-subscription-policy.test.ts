import { describe, expect, it } from "vitest";
import { maySubscribeToAirDownlink } from
  "./air-downlink-subscription-policy.js";

describe("Air downlink subscription policy", () => {
  const worker = {
    identity:
      "session-1:worker:voice_agent_0123456789abcdef01234567_g1",
    metadata: JSON.stringify({
      participantRole: "worker",
      runtime: "voice_agent",
      dispatchGeneration: 1,
    }),
    attributes: {
      "translation.role": "worker",
      "translation.runtime": "voice_agent",
      "translation.generation": "1",
    },
  };
  const host = {
    identity: "session-1:host:12345678-1234-1234-1234-123456789abc",
    attributes: {
      "ai.phone.call_id": "session-1",
      "ai.phone.participant_role": "host",
    },
  };

  it("allows only the bound worker for an isolated translation call", () => {
    expect(maySubscribeToAirDownlink({
      communicationSessionId: "session-1",
      mediaPolicy: "translation_isolated",
      participant: worker,
    })).toBe(true);
    expect(maySubscribeToAirDownlink({
      communicationSessionId: "session-1",
      mediaPolicy: "translation_isolated",
      participant: host,
    })).toBe(false);
  });

  it("keeps the bound host monitor for Voice Agent calls", () => {
    expect(maySubscribeToAirDownlink({
      communicationSessionId: "session-1",
      mediaPolicy: "agent_monitored",
      participant: host,
    })).toBe(true);
  });

  it.each([
    { ...worker, identity: "session-2:worker:voice_agent_abc_g1" },
    { ...worker, metadata: JSON.stringify({ participantRole: "host" }) },
    { ...worker, attributes: { ...worker.attributes,
      "translation.generation": "2" } },
    { ...host, attributes: { "ai.phone.participant_role": "host" } },
    { identity: "session-1:guest:air:air-001" },
  ])("rejects cross-session or unbound participants", (participant) => {
    expect(maySubscribeToAirDownlink({
      communicationSessionId: "session-1",
      mediaPolicy: "agent_monitored",
      participant,
    })).toBe(false);
  });
});
