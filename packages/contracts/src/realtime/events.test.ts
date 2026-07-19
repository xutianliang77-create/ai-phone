import { describe, expect, it } from "vitest";
import type { ClientRealtimeEvent, ServerRealtimeEvent } from "./events.js";

describe("realtime events", () => {
  it("supports translation final events", () => {
    const event: ServerRealtimeEvent = {
      type: "translation.final",
      sessionId: "sess_1",
      segmentId: "seg_1",
      text: "你好",
      language: "zh",
      providerUsage: {
        provider: "qwen_live",
        model: "qwen-plus",
        latencyMs: 420,
        estimatedTotalTokens: 8,
      },
    };

    expect(event.type).toBe("translation.final");
    expect(event.providerUsage?.provider).toBe("qwen_live");
  });

  it("supports client text segment events for mobile system ASR", () => {
    const event: ClientRealtimeEvent = {
      type: "client.text.segment",
      sessionId: "sess_1",
      segmentId: "seg_1",
      text: "hello",
      language: "en",
      isFinal: true,
      confidence: 0.91,
    };

    expect(event.type).toBe("client.text.segment");
  });

  it("supports diagnostic metadata on realtime errors", () => {
    const event: ServerRealtimeEvent = {
      type: "error",
      sessionId: "sess_1",
      code: "provider_unavailable",
      message: "ASR network connection failed",
      stage: "asr",
      provider: "hymt2_self_hosted",
      retryable: true,
    };

    expect(event.stage).toBe("asr");
    expect(event.retryable).toBe(true);
  });

  it("supports low-balance usage ticks and quota end reasons", () => {
    const tick: ServerRealtimeEvent = {
      type: "usage.tick",
      sessionId: "sess_1",
      billableSeconds: 270,
      remainingSeconds: 30,
      lowBalance: true,
    };
    const ended: ServerRealtimeEvent = {
      type: "session.ended",
      sessionId: "sess_1",
      reason: "quota_exhausted",
      billableSeconds: 300,
      remainingSeconds: 0,
    };

    expect(tick.lowBalance).toBe(true);
    expect(ended.reason).toBe("quota_exhausted");
  });

  it("supports final flush integrity metadata", () => {
    const ended: ServerRealtimeEvent = {
      type: "session.ended",
      sessionId: "sess_1",
      reason: "client_request",
      flush: {
        status: "completed",
        transcriptFinalCount: 1,
        translationFinalCount: 1,
        translationFailedCount: 0,
        unresolvedSegmentCount: 0,
        pipelineErrorCount: 0,
        audioFlushed: true,
        providerFlushed: true,
      },
    };

    expect(ended.flush?.status).toBe("completed");
    expect(ended.flush?.unresolvedSegmentCount).toBe(0);
  });

  it("supports authoritative and late speaker attribution", () => {
    const event: ServerRealtimeEvent = {
      type: "speaker.updated",
      sessionId: "sess_1",
      segmentId: "seg_1",
      speaker: {
        speakerId: "speaker_2",
        role: "speaker",
        source: "diarization",
        confidence: 0.91,
      },
      timing: { startMs: 1000, endMs: 1800, source: "client" },
    };

    expect(event.speaker.speakerId).toBe("speaker_2");
  });
});
