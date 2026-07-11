import { describe, expect, it } from "vitest";
import type { ClientTextSegmentEvent } from "@translation/contracts";
import { textSegmentLogPayload } from "./text-segment-logger.js";

describe("text segment logger", () => {
  it("keeps transcript text out of log payloads", () => {
    const event: ClientTextSegmentEvent = {
      type: "client.text.segment",
      sessionId: "sess_1",
      segmentId: "seg_1",
      text: "private transcript text",
      language: "en",
      isFinal: true,
      confidence: 0.91,
    };

    const payload = textSegmentLogPayload(event, 3);

    expect(payload).toEqual({
      sessionId: "sess_1",
      count: 3,
      segmentId: "seg_1",
      language: "en",
      isFinal: true,
      charCount: 23,
      confidence: 0.91,
    });
    expect("text" in payload).toBe(false);
  });
});
