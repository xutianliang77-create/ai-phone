import { describe, expect, it } from "vitest";
import {
  parseAgentDeliveryCommand,
  parseAgentDeliveryLifecycleEvent,
} from "./agent-delivery.js";

describe("Agent delivery contract", () => {
  const binding = {
    deliveryAttemptId: "delivery-1",
    workId: "work-1",
    sessionId: "session-1",
    legId: "leg-host",
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
  };

  it("requires an exact Worker target on a playback command", () => {
    const command = {
      version: 1,
      type: "agent.delivery.play",
      commandId: "command-1",
      ...binding,
      announcementText: "Background work finished.",
      issuedAt: "2026-07-30T08:00:00.000Z",
      expiresAt: "2026-07-30T08:05:00.000Z",
    };
    expect(parseAgentDeliveryCommand(command)).toEqual(command);
    expect(() => parseAgentDeliveryCommand({
      ...command,
      workerParticipantIdentity: "",
    })).toThrow("workerParticipantIdentity");
  });

  it("requires failureCode only for failed lifecycle events", () => {
    const event = {
      version: 1,
      eventId: "event-1",
      type: "agent.delivery.failed",
      ...binding,
      failureCode: "tts_failed",
      occurredAt: "2026-07-30T08:00:05.000Z",
    };
    expect(parseAgentDeliveryLifecycleEvent(event)).toEqual(event);
    expect(() => parseAgentDeliveryLifecycleEvent({
      ...event,
      failureCode: undefined,
    })).toThrow("failure binding");
  });
});
