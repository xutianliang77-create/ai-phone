import { describe, expect, it } from "vitest";
import { parseCallRoomEventRequest } from "./call-room-event-request.js";
import type { CallLinkRecord } from "./call-links.service.js";

describe("parseCallRoomEventRequest", () => {
  it("keeps ASR correction provenance and timing", () => {
    const parsed = parseCallRoomEventRequest({ events: [{
      type: "transcript.final",
      segmentId: "segment_1",
      speakerRole: "host",
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "会议纪要。",
      rawText: "会议既要。",
      optimizedText: "会议纪要。",
      confidence: 0.82,
      refinement: {
        provider: "openai_compatible",
        model: "qwen/qwen3.5-9b",
        promptVersion: "asr_refine_v2",
        confidence: 0.94,
        latencyMs: 320,
        operations: ["term_correction"],
        protectedTermsKept: ["会议纪要"],
        warnings: [],
      },
      timing: { startMs: 100, endMs: 900, source: "model" },
      timestampMs: 1000,
    }] }, record());

    expect(parsed).toMatchObject({
      ok: true,
      events: [{
        rawText: "会议既要。",
        optimizedText: "会议纪要。",
        confidence: 0.82,
        refinement: { provider: "openai_compatible" },
        timing: { startMs: 100, endMs: 900, source: "model" },
      }],
    });
  });
});

function record(): CallLinkRecord {
  return {
    callId: "call_1",
    sessionId: "call_1",
    roomName: "call_call_1",
    roomProvider: "livekit",
    joinUrl: "https://call.example.cn/join/call_1",
    hostUrl: "https://call.example.cn/host/call_1",
    status: "active",
    mode: "call_link",
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: "2026-07-13T01:00:00.000Z",
  };
}
