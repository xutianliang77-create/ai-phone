import { afterEach, describe, expect, it } from "vitest";
import { parseCallRoomEventRequest } from "./call-room-event-request.js";
import type { CallLinkRecord } from "./call-links.service.js";

describe("parseCallRoomEventRequest", () => {
  const previousMaxBytes = process.env.CALL_ROOM_MAX_DATA_PACKET_BYTES;
  const previousMaxEvents = process.env.CALL_ROOM_MAX_EVENTS_PER_REQUEST;

  afterEach(() => {
    restoreEnv("CALL_ROOM_MAX_DATA_PACKET_BYTES", previousMaxBytes);
    restoreEnv("CALL_ROOM_MAX_EVENTS_PER_REQUEST", previousMaxEvents);
  });
  it("keeps ASR correction provenance and timing", async () => {
    const parsed = await parseCallRoomEventRequest({ events: [{
      type: "transcript.final",
      segmentId: "segment_1",
      speechId: "speech_1",
      turnId: "turn_1",
      revision: 2,
      pipelineGeneration: 3,
      pipelineTiming: {
        asrStartedAtMs: 100,
        asrFinalAtMs: 700,
        transcriptReadyAtMs: 1000,
      },
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
        speechId: "speech_1",
        turnId: "turn_1",
        revision: 2,
        pipelineGeneration: 3,
        pipelineTiming: {
          asrStartedAtMs: 100,
          asrFinalAtMs: 700,
          transcriptReadyAtMs: 1000,
        },
        rawText: "会议既要。",
        optimizedText: "会议纪要。",
        confidence: 0.82,
        refinement: { provider: "openai_compatible" },
        timing: { startMs: 100, endMs: 900, source: "model" },
      }],
    });
  });

  it("rejects invalid pipeline identity and timing", async () => {
    expect(await parseCallRoomEventRequest({
      events: [{ ...event(), revision: -1 }],
    }, record())).toMatchObject({
      ok: false,
      code: "invalid_call_room_event",
    });
    expect(await parseCallRoomEventRequest({
      events: [{
        ...event(),
        pipelineGeneration: 1,
        pipelineTiming: { asrStartedAtMs: -1 },
      }],
    }, record())).toMatchObject({
      ok: false,
      code: "invalid_call_room_event",
    });
  });

  it("rejects events bound to another call id", async () => {
    const parsed = await parseCallRoomEventRequest({
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

  it("accepts a positive integer expected version", async () => {
    expect(await parseCallRoomEventRequest({
      expectedVersion: 7,
      events: [event()],
    }, record())).toMatchObject({ ok: true, expectedVersion: 7 });
    expect(await parseCallRoomEventRequest({
      expectedVersion: 0,
      events: [event()],
    }, record())).toMatchObject({ ok: false, code: "invalid_call_room_event" });
  });

  it("rejects oversized event packets", async () => {
    process.env.CALL_ROOM_MAX_DATA_PACKET_BYTES = "1024";

    const parsed = await parseCallRoomEventRequest({
      events: [{ ...event(), text: "x".repeat(2000) }],
    }, record());

    expect(parsed).toMatchObject({
      ok: false,
      code: "call_room_event_too_large",
    });
  });

  it("applies the configured batch count", async () => {
    process.env.CALL_ROOM_MAX_EVENTS_PER_REQUEST = "1";

    const parsed = await parseCallRoomEventRequest({
      events: [event(), { ...event(), segmentId: "segment-2" }],
    }, record());

    expect(parsed).toMatchObject({
      ok: false,
      code: "too_many_call_room_events",
    });
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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
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
