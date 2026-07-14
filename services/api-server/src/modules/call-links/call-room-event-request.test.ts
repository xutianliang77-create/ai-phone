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

  it("rejects events bound to another call id", () => {
    const parsed = parseCallRoomEventRequest({
      callId: "call_other",
      events: [{
        type: "transcript.final",
        segmentId: "segment_1",
        speakerRole: "host",
        sourceLanguage: "zh",
        targetLanguage: "en",
        text: "你好。",
      }],
    }, record());

    expect(parsed).toEqual({
      ok: false,
      code: "call_link_binding_conflict",
      message: "Call event binding does not match the requested call link",
    });
  });

  it("accepts a positive integer expected version", () => {
    expect(parseCallRoomEventRequest({
      expectedVersion: 7,
      events: [event()],
    }, record())).toMatchObject({ ok: true, expectedVersion: 7 });
    expect(parseCallRoomEventRequest({
      expectedVersion: 0,
      events: [event()],
    }, record())).toMatchObject({ ok: false, code: "invalid_call_room_event" });
  });
});

function event() {
  return {
    type: "transcript.final",
    segmentId: "segment-1",
    speakerRole: "guest",
    sourceLanguage: "en",
    targetLanguage: "zh",
    text: "hello",
    timestampMs: 1,
  };
}

function record(): CallLinkRecord {
  return {
    callId: "call_1",
    sessionId: "call_1",
    roomName: "call_call_1",
    roomProvider: "livekit",
    joinUrl: "https://call.example.cn/join/call_1",
    hostUrl: "https://call.example.cn/host/call_1",
    status: "active",
    version: 1,
    mode: "call_link",
    createdAt: "2026-07-13T00:00:00.000Z",
    expiresAt: "2026-07-13T01:00:00.000Z",
  };
}
