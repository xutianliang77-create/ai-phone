import { describe, expect, it } from "vitest";
import type { CallRoomDataEvent } from "./events.js";

describe("call room events", () => {
  it("carries speech identity, revision and stage timing", () => {
    const event: CallRoomDataEvent = {
      type: "translation.final",
      callId: "call_1",
      roomName: "call_call_1",
      segmentId: "seg_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 2,
      pipelineGeneration: 3,
      pipelineTiming: {
        asrStartedAtMs: 100,
        asrFinalAtMs: 220,
        translationFinalAtMs: 310,
      },
      speakerRole: "guest",
      speaker: {
        speakerId: "guest",
        role: "guest",
        source: "participant_track",
        confidence: 1,
      },
      sourceLanguage: "en",
      targetLanguage: "zh",
      text: "你好",
      timestampMs: 310,
    };

    expect(event.pipelineGeneration).toBe(3);
    expect(event.pipelineTiming?.translationFinalAtMs).toBe(310);
  });

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
