import { describe, expect, it } from "vitest";
import { agentDeliveryTopic, type AgentDeliveryCommand } from
  "@translation/contracts";
import {
  AgentDeliveryInbox,
  AgentDeliveryInboxError,
} from "./agent-delivery-inbox.js";

describe("Agent delivery inbox", () => {
  it("deduplicates an exact replay without returning a second command", () => {
    const inbox = new AgentDeliveryInbox();
    expect(accept(inbox, command())).not.toBeNull();
    expect(accept(inbox, command())).toBeNull();
  });

  it("rejects command id reuse with a different payload", () => {
    const inbox = new AgentDeliveryInbox();
    expect(accept(inbox, command())).not.toBeNull();
    expect(() => accept(inbox, {
      ...command(),
      announcementText: "Different announcement.",
    })).toThrow(AgentDeliveryInboxError);
  });

  it("rejects a stale Worker or dispatch binding", () => {
    const inbox = new AgentDeliveryInbox();
    expect(accept(inbox, {
      ...command(),
      workerParticipantIdentity: "session-1:worker:stale_g3",
    })).toBeNull();
  });
});

function accept(inbox: AgentDeliveryInbox, value: AgentDeliveryCommand) {
  return inbox.accept({
    data: new TextEncoder().encode(JSON.stringify(value)),
    hasParticipant: false,
    topic: agentDeliveryTopic,
    snapshot: {
      sessionId: "session-1",
      callId: "session-1",
      calleeParticipantIdentity: "session-1:guest:air:air-001",
      participantIdentity: "session-1:worker:voice_agent_001_g4",
      generation: 4,
    } as never,
    now: new Date("2026-08-13T10:00:01.000Z"),
  });
}

function command(): AgentDeliveryCommand {
  return {
    version: 1,
    type: "agent.delivery.play",
    commandId: "command-1",
    deliveryAttemptId: "delivery-1",
    workId: "work-1",
    sessionId: "session-1",
    legId: "session-1:guest:air:air-001",
    turnId: "turn-7",
    turnGeneration: 4,
    dispatchGeneration: 4,
    clientInstanceId: "client-ios-1",
    clientParticipantIdentity: "session-1:host:user-1",
    workerParticipantIdentity: "session-1:worker:voice_agent_001_g4",
    ownershipLeaseId: "voice-lease-1",
    ownershipGeneration: 6,
    playbackId: "playback-1",
    playbackGeneration: 11,
    announcementText: "Background work finished.",
    issuedAt: "2026-08-13T10:00:00.000Z",
    expiresAt: "2026-08-13T10:05:00.000Z",
  };
}
