import { describe, expect, it } from "vitest";
import {
  reconcileSpeakerRevision,
  type RevisableSpeakerSegment,
} from "./speaker-revision-reconciler.js";
import type { SpeakerRevisionResult } from "./speaker-revision-provider.js";

describe("speaker revision reconciler", () => {
  it("uses a verified two-speaker window without changing transcript fields", () => {
    const result = reconcileSpeakerRevision(iphoneRevision(), [
      segment("seg_1", 0, 6_000, "speaker_1"),
      segment("seg_2", 6_000, 12_100, "speaker_1"),
      segment("seg_3", 12_200, 18_300, "speaker_2"),
    ]);

    expect(result.accepted).toBe(true);
    expect(result.labelMapping).toEqual({
      S01: "speaker_1",
      S02: "speaker_2",
    });
    expect(result.updates).toEqual([
      expect.objectContaining({
        type: "speaker.updated",
        segmentId: "seg_2",
        speakerRevision: 1,
        speaker: {
          speakerId: "unknown",
          role: "unknown",
          source: "unknown",
        },
        timing: expect.objectContaining({
          overlap: false,
          activeSpeakerIds: ["speaker_1", "speaker_2"],
        }),
      }),
      expect.objectContaining({
        type: "speaker.updated",
        segmentId: "seg_3",
        speakerRevision: 1,
        speaker: {
          speakerId: "speaker_2",
          role: "speaker",
          source: "diarization",
        },
        timing: expect.objectContaining({
          overlap: true,
          activeSpeakerIds: ["speaker_1", "speaker_2"],
        }),
      }),
    ]);
  });

  it("allocates a new anonymous id when revision evidence finds a new speaker", () => {
    const revision: SpeakerRevisionResult = {
      sessionId: "sess_1",
      generation: 1,
      windowStartMs: 0,
      windowEndMs: 10_000,
      provider: "moss",
      speakerCount: 2,
      spans: [
        { speakerId: "S01", startMs: 0, endMs: 4_800 },
        { speakerId: "S02", startMs: 5_000, endMs: 9_800 },
      ],
    };
    const result = reconcileSpeakerRevision(revision, [
      segment("seg_1", 0, 4_800, "speaker_1"),
      segment("seg_2", 5_000, 9_800, "unknown"),
    ]);

    expect(result.labelMapping).toEqual({
      S01: "speaker_1",
      S02: "speaker_2",
    });
    expect(result.updates).toEqual([
      expect.objectContaining({
        segmentId: "seg_2",
        speaker: expect.objectContaining({ speakerId: "speaker_2" }),
      }),
    ]);
  });

  it("does not erase an existing streaming overlap", () => {
    const input = segment("overlap", 0, 1_000, "unknown");
    input.timing = {
      ...input.timing!,
      overlap: true,
      activeSpeakerIds: ["speaker_1", "speaker_2"],
    };
    const result = reconcileSpeakerRevision({
      sessionId: "sess_1",
      generation: 1,
      windowStartMs: 0,
      windowEndMs: 1_000,
      provider: "sortformer_high_context",
      speakerCount: 1,
      spans: [{ speakerId: "S01", startMs: 0, endMs: 1_000 }],
    }, [input]);

    expect(result.accepted).toBe(true);
    expect(result.updates).toEqual([]);
  });

  it("rejects stale, cross-session, and malformed revision evidence", () => {
    const malformed = iphoneRevision();
    malformed.spans[1] = { ...malformed.spans[1], startMs: 200 };
    expect(reconcileSpeakerRevision(malformed, [
      segment("seg_1", 0, 6_000, "speaker_1"),
    ])).toMatchObject({
      accepted: false,
      reason: "invalid_span",
      updates: [],
    });

    expect(reconcileSpeakerRevision(iphoneRevision(), [{
      ...segment("seg_1", 0, 6_000, "speaker_1"),
      sessionId: "another_session",
    }])).toMatchObject({
      accepted: false,
      reason: "session_mismatch",
    });
  });
});

function segment(
  segmentId: string,
  startMs: number,
  endMs: number,
  speakerId: string,
): RevisableSpeakerSegment {
  return {
    sessionId: "sess_1",
    segmentId,
    turnId: `turn_${segmentId}`,
    speakerRevision: 0,
    speaker: speakerId === "unknown"
      ? { speakerId, role: "unknown", source: "unknown" }
      : { speakerId, role: "speaker", source: "diarization" },
    timing: { startMs, endMs, source: "client" },
  };
}

function iphoneRevision(): SpeakerRevisionResult {
  return {
    sessionId: "sess_1",
    generation: 1,
    windowStartMs: 0,
    windowEndMs: 25_000,
    provider: "moss",
    model: "MOSS-Transcribe-Diarize-0.9B",
    speakerCount: 2,
    spans: [
      { speakerId: "S01", startMs: 650, endMs: 4_890 },
      { speakerId: "S02", startMs: 5_040, endMs: 8_880 },
      { speakerId: "S01", startMs: 8_810, endMs: 12_070 },
      { speakerId: "S02", startMs: 12_250, endMs: 17_710, overlap: true },
      { speakerId: "S01", startMs: 16_910, endMs: 18_150, overlap: true },
      { speakerId: "S02", startMs: 17_710, endMs: 18_210, overlap: true },
    ],
  };
}
