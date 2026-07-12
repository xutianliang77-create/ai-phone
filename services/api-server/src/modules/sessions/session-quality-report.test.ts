import { describe, expect, it } from "vitest";
import type { SessionRecord } from "./session-record.js";
import { buildSessionQualityReport } from "./session-quality-report.js";

describe("session quality report", () => {
  it("summarizes quality evidence without transcript text", () => {
    const report = buildSessionQualityReport(sampleSession(), new Date(0));

    expect(report).toMatchObject({
      version: 1,
      sessionId: "quality-session",
      generatedAt: "1970-01-01T00:00:00.000Z",
      segments: {
        total: 2,
        translated: 1,
        sourceOnly: 1,
        translationCoverage: 0.5,
      },
      latency: {
        sampleCount: 2,
        averageMs: 1750,
        p95Ms: 3000,
        maxMs: 3000,
      },
      audio: { receivedFrames: 100, droppedFrames: 2, dropRate: 0.02 },
      speakers: { identified: 1, unknownSegments: 1, overlapSegments: 1 },
      endpoints: { silence: 1, max_duration: 1 },
    });
    expect(report.flags).toEqual([
      "source_without_translation",
      "audio_frames_dropped",
      "vad_fallback",
      "unknown_speaker",
      "high_translation_latency",
      "max_duration_endpoint",
    ]);
    expect(JSON.stringify(report)).not.toContain("sensitive transcript");
  });

  it("reports an empty session deterministically", () => {
    const session = sampleSession();
    session.segments = [];
    delete session.diagnostics;
    const report = buildSessionQualityReport(session, new Date(0));

    expect(report.segments.translationCoverage).toBe(0);
    expect(report.latency).toEqual({
      sampleCount: 0,
      averageMs: 0,
      p95Ms: 0,
      maxMs: 0,
    });
    expect(report.flags).toEqual(["no_segments", "missing_audio_diagnostics"]);
  });
});

function sampleSession(): SessionRecord {
  return {
    id: "quality-session",
    userId: "guest-user",
    mode: "conversation",
    status: "ended",
    consumedSeconds: 12,
    createdAt: "2026-07-13T00:00:00.000Z",
    endedAt: "2026-07-13T00:00:12.000Z",
    segments: [
      {
        id: "one",
        sourceText: "sensitive transcript one",
        translatedText: "translated",
        latencyMs: 500,
        stage: "translation",
        provider: "translation-provider",
        model: "model-a",
        speaker: {
          speakerId: "speaker_1",
          role: "speaker",
          source: "diarization",
        },
        timing: { startMs: 0, endMs: 1000, source: "model" },
        vadContext: {
          endpointReason: "silence",
          endpointPolicyFingerprint: "a".repeat(64),
        },
      },
      {
        id: "two",
        sourceText: "sensitive transcript two",
        translatedText: "",
        latencyMs: 3000,
        stage: "translation",
        provider: "translation-provider",
        model: "model-a",
        timing: {
          startMs: 1000,
          endMs: 2000,
          source: "model",
          overlap: true,
        },
        vadContext: {
          endpointReason: "max_duration",
          endpointPolicyFingerprint: "a".repeat(64),
        },
      },
    ],
    diagnostics: {
      version: 1,
      audio: {
        receivedFrameCount: 100,
        processedBatchCount: 10,
        droppedFrameCount: 2,
      },
      vad: {
        configuredProvider: "marblenet",
        activeProvider: "rms_fallback",
        threshold: 0.5,
        analyzedFrameCount: 100,
        speechFrameCount: 50,
        speechFrameRatio: 0.5,
        fallbackCount: 1,
        fallbackReason: "runtime_failed",
        modelFingerprint: "b".repeat(64),
        endpointPolicy: {
          mode: "conversation",
          minAudioMs: 300,
          endpointSilenceMs: 900,
          maxAudioMs: 10000,
          prerollMs: 200,
          fingerprint: "c".repeat(64),
        },
      },
    },
  };
}
