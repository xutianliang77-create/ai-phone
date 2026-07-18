import { afterEach, describe, expect, it } from "vitest";
import {
  callRoomResourceLimitIssues,
  getCallRoomResourceLimits,
} from "./call-room-resource-limits.js";

describe("call room resource limits", () => {
  const previous = { ...process.env };

  afterEach(() => {
    for (const key of resourceEnvKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses production-safe bounded defaults", () => {
    for (const key of resourceEnvKeys) delete process.env[key];

    expect(getCallRoomResourceLimits()).toEqual({
      guestTicketTtlSeconds: 300,
      maxParticipants: 3,
      maxSessionSeconds: 3600,
      emptyTimeoutSeconds: 300,
      maxDataPacketBytes: 12_288,
      maxEventsPerRequest: 20,
      maxEventRequestsPerSecond: 40,
      maxParticipantNameCharacters: 80,
    });
    expect(callRoomResourceLimitIssues()).toEqual([]);
  });

  it("fails readiness and falls back when a configured limit is unsafe", () => {
    process.env.CALL_ROOM_MAX_PARTICIPANTS = "100";
    process.env.CALL_ROOM_MAX_DATA_PACKET_BYTES = "16000";

    expect(callRoomResourceLimitIssues()).toEqual([
      "call room CALL_ROOM_MAX_PARTICIPANTS must be 3-8",
      "call room CALL_ROOM_MAX_DATA_PACKET_BYTES must be 1024-15000",
    ]);
    expect(getCallRoomResourceLimits()).toMatchObject({
      maxParticipants: 3,
      maxDataPacketBytes: 12_288,
    });
  });
});

const resourceEnvKeys = [
  "CALL_GUEST_TICKET_TTL_SECONDS",
  "CALL_ROOM_MAX_PARTICIPANTS",
  "CALL_ROOM_MAX_SESSION_SECONDS",
  "CALL_ROOM_EMPTY_TIMEOUT_SECONDS",
  "CALL_ROOM_MAX_DATA_PACKET_BYTES",
  "CALL_ROOM_MAX_EVENTS_PER_REQUEST",
  "CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND",
  "CALL_ROOM_MAX_PARTICIPANT_NAME_CHARACTERS",
];
