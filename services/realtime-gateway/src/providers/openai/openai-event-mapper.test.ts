import { describe, expect, it } from "vitest";
import { mapOpenAiRealtimeEvent } from "./openai-event-mapper.js";

const context = {
  sessionId: "sess_1",
  sourceLanguage: "auto" as const,
  targetLanguage: "zh" as const,
};

describe("openai realtime event mapper", () => {
  it("maps input transcript deltas to transcript partials", () => {
    const events = mapOpenAiRealtimeEvent({
      type: "session.input_transcript.delta",
      item_id: "item_1",
      delta: "hello",
    }, context);

    expect(events).toEqual([{
      type: "transcript.partial",
      sessionId: "sess_1",
      segmentId: "item_1",
      text: "hello",
      language: "en",
    }]);
  });

  it("maps output transcript done events to translation finals", () => {
    const events = mapOpenAiRealtimeEvent({
      type: "session.output_transcript.done",
      item_id: "item_1",
      transcript: "你好",
    }, context);

    expect(events[0]).toMatchObject({
      type: "translation.final",
      sessionId: "sess_1",
      segmentId: "item_1",
      text: "你好",
      language: "zh",
    });
  });
});
