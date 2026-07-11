import { describe, expect, it } from "vitest";
import type { CallRoomDataEvent } from "./events.js";

describe("call room events", () => {
  it("supports structured worker status diagnostics", () => {
    const event: CallRoomDataEvent = {
      type: "worker.status",
      callId: "call_1",
      roomName: "call_call_1",
      segmentId: "asr-failed-host-7",
      speakerRole: "worker",
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "ASR 识别失败，已继续监听",
      stage: "asr",
      retryable: true,
      timestampMs: 1,
    };

    expect(event.stage).toBe("asr");
    expect(event.retryable).toBe(true);
  });
});
