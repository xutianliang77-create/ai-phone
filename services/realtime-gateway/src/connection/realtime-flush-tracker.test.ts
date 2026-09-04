import { describe, expect, it } from "vitest";
import type { ServerRealtimeEvent } from "@translation/contracts";
import { RealtimeFlushTracker } from "./realtime-flush-tracker.js";

describe("realtime flush tracker", () => {
  it("reports a translated tail as completed", () => {
    const tracker = new RealtimeFlushTracker();
    tracker.beginFinalization();
    tracker.record(transcript("tail"));
    tracker.record(translation("tail"));

    expect(tracker.summarize(successfulSteps())).toEqual({
      status: "completed",
      transcriptFinalCount: 1,
      translationFinalCount: 1,
      translationFailedCount: 0,
      unresolvedSegmentCount: 0,
      pipelineErrorCount: 0,
      audioFlushed: true,
      providerFlushed: true,
    });
  });

  it("includes a pre-existing unresolved transcript in finalization", () => {
    const tracker = new RealtimeFlushTracker();
    tracker.record(transcript("tail"));
    tracker.beginFinalization();
    tracker.record(translation("tail"));

    expect(tracker.summarize(successfulSteps())).toMatchObject({
      status: "completed",
      transcriptFinalCount: 1,
      translationFinalCount: 1,
      unresolvedSegmentCount: 0,
    });
  });

  it("reports empty audio separately from degraded finalization", () => {
    const empty = new RealtimeFlushTracker();
    empty.beginFinalization();
    expect(empty.summarize(successfulSteps()).status).toBe("empty");

    const degraded = new RealtimeFlushTracker();
    degraded.beginFinalization();
    degraded.record(transcript("tail"));
    expect(degraded.summarize({
      audioFlushed: true,
      providerFlushed: false,
    })).toMatchObject({
      status: "degraded",
      unresolvedSegmentCount: 1,
      providerFlushed: false,
    });
  });

  it("counts a flush-time provider error", () => {
    const tracker = new RealtimeFlushTracker();
    tracker.beginFinalization();
    tracker.record({
      type: "error",
      code: "provider_unavailable",
      message: "ASR flush failed",
      stage: "asr",
      retryable: true,
    });
    expect(tracker.summarize(successfulSteps())).toMatchObject({
      status: "degraded",
      pipelineErrorCount: 1,
    });
  });

  it("reports a preserved transcript with failed translation as degraded", () => {
    const tracker = new RealtimeFlushTracker();
    tracker.beginFinalization();
    tracker.record(transcript("tail"));
    tracker.record({
      type: "translation.failed",
      sessionId: "sess_1",
      segmentId: "tail",
      message: "翻译暂不可用",
      language: "zh",
      stage: "translation",
    });

    expect(tracker.summarize(successfulSteps())).toMatchObject({
      status: "degraded",
      transcriptFinalCount: 1,
      translationFinalCount: 0,
      translationFailedCount: 1,
      unresolvedSegmentCount: 0,
    });
  });

  it("removes an absorbed continuation tombstone from flush accounting", () => {
    const tracker = new RealtimeFlushTracker();
    tracker.record(transcript("absorbed"));
    tracker.beginFinalization();
    tracker.record({
      type: "transcript.final",
      sessionId: "sess_1",
      segmentId: "absorbed",
      text: "",
      language: "zh",
    });

    expect(tracker.summarize(successfulSteps())).toEqual({
      status: "empty",
      transcriptFinalCount: 0,
      translationFinalCount: 0,
      translationFailedCount: 0,
      unresolvedSegmentCount: 0,
      pipelineErrorCount: 0,
      audioFlushed: true,
      providerFlushed: true,
    });
  });
});

function transcript(segmentId: string): ServerRealtimeEvent {
  return {
    type: "transcript.final",
    sessionId: "sess_1",
    segmentId,
    text: "tail audio",
    language: "en",
  };
}

function translation(segmentId: string): ServerRealtimeEvent {
  return {
    type: "translation.final",
    sessionId: "sess_1",
    segmentId,
    text: "尾句",
    language: "zh",
  };
}

function successfulSteps() {
  return { audioFlushed: true, providerFlushed: true };
}
