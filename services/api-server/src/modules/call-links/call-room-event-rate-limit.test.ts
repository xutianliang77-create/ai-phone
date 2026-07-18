import { afterEach, describe, expect, it } from "vitest";
import {
  consumeCallRoomEventRequest,
  resetCallRoomEventRateLimitsForTests,
} from "./call-room-event-rate-limit.js";

describe("call room event rate limit", () => {
  const previous = process.env.CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND;

  afterEach(() => {
    resetCallRoomEventRateLimitsForTests();
    if (previous === undefined) {
      delete process.env.CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND;
    } else {
      process.env.CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND = previous;
    }
  });

  it("rejects a burst above the per-session limit and resets next window", () => {
    process.env.CALL_ROOM_MAX_EVENT_REQUESTS_PER_SECOND = "2";

    expect(consumeCallRoomEventRequest("call-1", 1000)).toBe(true);
    expect(consumeCallRoomEventRequest("call-1", 1001)).toBe(true);
    expect(consumeCallRoomEventRequest("call-1", 1002)).toBe(false);
    expect(consumeCallRoomEventRequest("call-2", 1002)).toBe(true);
    expect(consumeCallRoomEventRequest("call-1", 2000)).toBe(true);
  });
});
