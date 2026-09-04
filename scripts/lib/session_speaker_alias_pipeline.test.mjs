import { describe, expect, it } from "vitest";
import {
  applySpeakerUpdates,
  buildAliasInputSegments,
  buildAliasSegments,
  encodePcm16Wav,
  mergeSpeakerSpans,
  parsePcm16Wav,
  percentile,
  streamSpeakerAudio,
} from "./session_speaker_alias_pipeline.mjs";
import { filterPendingSpeakerSpans } from "./pending_speaker_activation.mjs";
import {
  summarizeAliasPipeline,
} from "./session_speaker_alias_pipeline_report.mjs";
import {
  summarizeSafetyGates,
} from "./session_speaker_alias_safety_report.mjs";

describe("session speaker alias pipeline helpers", () => {
  it("round-trips mono PCM16 WAV without changing samples", () => {
    const pcm = Buffer.alloc(16_000 * 2);
    pcm.writeInt16LE(1234, 0);

    const parsed = parsePcm16Wav(encodePcm16Wav(pcm, 16_000));

    expect(parsed.sampleRate).toBe(16_000);
    expect(parsed.durationMs).toBe(1_000);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("replaces provisional spans while retaining first observation time", () => {
    const index = new Map();
    mergeSpeakerSpans(index, [{
      speakerId: "speaker_1",
      startMs: 0,
      endMs: 800,
      final: false,
    }], 1_000);
    mergeSpeakerSpans(index, [{
      speakerId: "speaker_1",
      startMs: 0,
      endMs: 1_600,
      final: true,
    }], 2_000);

    expect([...index.values()]).toEqual([{
      speakerId: "speaker_1",
      startMs: 0,
      endMs: 1_600,
      final: true,
      firstObservedAudioMs: 1_000,
    }]);
  });

  it("builds ordered revision segments and locks overlap diagnostics", () => {
    const spans = [
      {
        speakerId: "speaker_1",
        startMs: 0,
        endMs: 2_500,
        overlap: false,
      },
      {
        speakerId: "speaker_2",
        startMs: 1_800,
        endMs: 2_600,
        overlap: true,
      },
    ];

    const regular = buildAliasSegments("case_1", spans, 1_000, false);
    const diagnostic = buildAliasSegments("case_1", spans, 1_000, true);

    expect(regular.map((item) => [
      item.rawSpeakerId,
      item.startMs,
      item.endMs,
      item.overlap,
    ])).toEqual([
      ["speaker_1", 0, 1_000, false],
      ["speaker_1", 1_000, 2_000, false],
      ["speaker_2", 1_800, 2_600, true],
      ["speaker_1", 2_000, 2_500, false],
    ]);
    expect(diagnostic.every((item) => item.overlap)).toBe(true);
  });

  it("filters only unconfirmed speaker activation runs", () => {
    const spans = [
      speakerSpan("speaker_1", 0, 80),
      speakerSpan("speaker_2", 80, 160),
      speakerSpan("speaker_2", 160, 240, true),
      speakerSpan("speaker_3", 400, 480),
      speakerSpan("speaker_3", 720, 880),
    ];

    expect(filterPendingSpeakerSpans(spans, 100)).toEqual([
      speakerSpan("speaker_2", 80, 160),
      speakerSpan("speaker_2", 160, 240, true),
      speakerSpan("speaker_3", 720, 880),
    ]);
  });

  it("injects two evidence-eligible slots only for controlled replay", () => {
    const replay = buildAliasInputSegments({
      caseId: "case_1",
      spans: [],
      durationMs: 5_000,
      segmentMs: 1_000,
      minimumEvidenceMs: 1_500,
      diagnosticOnly: false,
      inputMode: "controlled-slot-switch",
    });
    const short = buildAliasInputSegments({
      caseId: "case_2",
      spans: [],
      durationMs: 2_000,
      segmentMs: 1_000,
      minimumEvidenceMs: 1_500,
      diagnosticOnly: false,
      inputMode: "controlled-slot-switch",
    });

    expect(new Set(replay.map((item) => item.rawSpeakerId)).size).toBe(2);
    expect(new Set(short.map((item) => item.rawSpeakerId)).size).toBe(1);
  });

  it("applies speaker.updated revisions without losing raw slots", () => {
    const segments = [{
      segmentId: "case_1:1",
      rawSpeakerId: "speaker_2",
      canonicalSpeakerId: "speaker_2",
      revision: 0,
    }];

    applySpeakerUpdates(segments, [{
      segmentId: "case_1:1",
      revision: 1,
      speaker: { speakerId: "speaker_1" },
    }]);

    expect(segments).toEqual([{
      segmentId: "case_1:1",
      rawSpeakerId: "speaker_2",
      canonicalSpeakerId: "speaker_1",
      revision: 1,
    }]);
  });

  it("uses interpolated percentiles for revision latency", () => {
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([10, 20], 0.95)).toBe(19.5);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("streams every PCM frame and flushes final speaker spans", async () => {
    const wav = parsePcm16Wav(encodePcm16Wav(
      Buffer.alloc(16_000 * 2 * 1.2),
      16_000,
    ));
    const responses = [
      { spans: [] },
      {
        spans: [{
          speakerId: "speaker_1",
          startMs: 0,
          endMs: 800,
          final: false,
        }],
      },
      { spans: [] },
      {
        spans: [{
          speakerId: "speaker_1",
          startMs: 0,
          endMs: 1_200,
          final: true,
        }],
      },
    ];
    const fetchFn = async () => new Response(
      JSON.stringify(responses.shift()),
      { status: 200 },
    );

    const result = await streamSpeakerAudio({
      baseUrl: "http://127.0.0.1:8022",
      sessionId: "sess_1",
      wav,
      frameMs: 500,
      fetchFn,
    });

    expect(result.spans).toMatchObject([{
      speakerId: "speaker_1",
      endMs: 1_200,
      firstObservedAudioMs: 1_000,
    }]);
    expect(result.firstEvidenceAudioMs).toBe(1_000);
  });

  it("separates ordinary repair gates from overlap diagnostics", () => {
    const summary = summarizeAliasPipeline([
      caseResult({ rawCount: 2, canonicalCount: 1, revisionMs: 25 }),
      caseResult({ rawCount: 1, canonicalCount: 1 }),
      caseResult({
        diagnosticOnly: true,
        expectedCount: 2,
        rawCount: 1,
        canonicalCount: 1,
      }),
    ]);

    expect(summary.farField).toMatchObject({
      blankCases: 0,
      rawSplitCases: 1,
      repairedToOne: 1,
      unresolvedSplit: 0,
      zeroErrorCases: 1,
      zeroErrorPreserved: 1,
    });
    expect(summary.overlapDiagnosticOnly).toMatchObject({
      total: 1,
      aliasAppliedCases: 0,
      rawCountExact: 0,
    });
    expect(summary.alias.endToEndBackfillMs.p95).toBe(25);
    expect(summary.passed).toBe(true);
  });

  it("fails the ordinary gate when Sortformer returns no speaker", () => {
    const summary = summarizeAliasPipeline([
      caseResult({ rawCount: 0, canonicalCount: 0 }),
    ]);

    expect(summary.farField.blankCases).toBe(1);
    expect(summary.gates.ordinarySpeechDetected).toBe(false);
    expect(summary.passed).toBe(false);
  });

  it("requires retained pair recall and zero meeting auto-merges", () => {
    const pairs = [
      ...Array.from({ length: 35 }, () => ({
        sameSpeaker: true,
        accepted: true,
        latencyMs: 10,
        error: null,
      })),
      ...Array.from({ length: 7 }, () => ({
        sameSpeaker: true,
        accepted: false,
        latencyMs: 10,
        error: null,
      })),
      ...Array.from({ length: 41 }, () => ({
        sameSpeaker: false,
        accepted: false,
        latencyMs: 10,
        error: null,
      })),
    ];
    const meetings = Array.from({ length: 8 }, () => ({
      expectedSpeakerCount: 3,
      rawSpeakerCount: 3,
      canonicalSpeakerCount: 3,
      mergeDecisionCount: 0,
      error: null,
    }));

    expect(summarizeSafetyGates(pairs, meetings).passed).toBe(true);
    meetings[0].mergeDecisionCount = 1;
    expect(summarizeSafetyGates(pairs, meetings).passed).toBe(false);
  });
});

function caseResult({
  diagnosticOnly = false,
  expectedCount = 1,
  rawCount,
  canonicalCount,
  revisionMs,
}) {
  return {
    diagnosticOnly,
    expectedSpeakerCount: expectedCount,
    sortformer: { rawSpeakerCount: rawCount },
    alias: {
      canonicalSpeakerCount: canonicalCount,
      appliedSegmentCount: Math.max(0, rawCount - canonicalCount),
      observations: [],
      revisions: revisionMs === undefined
        ? []
        : [{ computeMs: revisionMs, endToEndBackfillMs: revisionMs }],
    },
    error: null,
  };
}

function speakerSpan(speakerId, startMs, endMs, overlap = false) {
  return {
    speakerId,
    startMs,
    endMs,
    overlap,
    final: true,
  };
}
