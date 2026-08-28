import { describe, expect, it } from "vitest";
import { parseVoiceAgentRuntimeEvent } from "./voice-agent-runtime-request.js";

describe("Voice Agent reliability runtime events", () => {
  it.each([
    "response_start_timeout",
    "audio_capacity_exceeded",
  ])("accepts the structured %s event", (event) => {
    expect(parseVoiceAgentRuntimeEvent({
      ticket: "signed-ticket",
      eventId: `event-${event}`,
      event,
      errorClass: event,
    })).toMatchObject({ event, errorClass: event });
  });

  it("rejects an uncontracted reliability event", () => {
    expect(parseVoiceAgentRuntimeEvent({
      ticket: "signed-ticket",
      eventId: "event-unknown",
      event: "translation_timeout",
    })).toBeNull();
  });
});
