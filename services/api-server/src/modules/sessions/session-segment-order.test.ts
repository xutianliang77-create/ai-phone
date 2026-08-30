import { describe, expect, it } from "vitest";
import { toSessionDetail, toSessionExport } from "./session-mappers.js";
import type { SessionRecord } from "./session-record.js";
import { localSessionReview } from "./session-review.js";
import { mergeSessionSegments } from "./session-segment-merge.js";
import { orderSessionSegmentsChronologically } from
  "./session-segment-order.js";

describe("session segment chronological order", () => {
  it("inserts late speaker split children by their authoritative timing", () => {
    const merged = mergeSessionSegments([
      segment("parent_a", "speaker_1", 0, 1_000),
      segment("next_b", "speaker_2", 1_400, 2_200),
      segment("parent_b", "speaker_2", 2_200, 3_000),
      segment("next_a", "speaker_1", 3_400, 4_000),
    ], [
      segment("child_b", "speaker_2", 1_000, 1_600),
      segment("child_a", "speaker_1", 3_000, 3_300),
    ]);

    expect(merged.map((item) => item.id)).toEqual([
      "parent_a",
      "child_b",
      "next_b",
      "parent_b",
      "child_a",
      "next_a",
    ]);
  });

  it("keeps arrival order when a segment lacks safe timing evidence", () => {
    const merged = mergeSessionSegments([
      segment("parent", "speaker_1", 0, 1_000),
      { id: "untimed", sourceText: "untimed", translatedText: "" },
    ], [segment("late_child", "speaker_2", 500, 800)]);

    expect(merged.map((item) => item.id)).toEqual([
      "parent",
      "untimed",
      "late_child",
    ]);
  });

  it("keeps arrival order for overlap or invalid timing", () => {
    const overlap = segment("overlap", "speaker_2", 500, 900);
    overlap.timing = { ...overlap.timing, overlap: true };
    const invalid = segment("invalid", "speaker_2", 900, 500);
    const existing = [
      segment("parent", "speaker_1", 0, 1_000),
      segment("next", "speaker_1", 1_000, 2_000),
    ];

    expect(mergeSessionSegments(existing, [overlap]).map((item) => item.id))
      .toEqual(["parent", "next", "overlap"]);
    expect(mergeSessionSegments(existing, [invalid]).map((item) => item.id))
      .toEqual(["parent", "next", "invalid"]);
  });

  it("normalizes old persisted records for API, export, and review", () => {
    const session = unsortedSession();

    expect(toSessionDetail(session).segments.map((segment) => segment.id))
      .toEqual(["parent", "child", "next"]);
    expect(JSON.parse(toSessionExport(session, "json").content).segments
      .map((segment: { id: string }) => segment.id))
      .toEqual(["parent", "child", "next"]);
    expect(localSessionReview(session).evidenceSegmentIds.slice(0, 3))
      .toEqual(["parent", "child", "next"]);
  });

  it("uses stable arrival order for equal start times", () => {
    const segments = unsortedSession().segments.map((segment) => ({
      ...segment,
      timing: { ...segment.timing!, startMs: 1_000 },
    }));

    expect(orderSessionSegmentsChronologically(segments)
      .map((segment) => segment.id))
      .toEqual(["parent", "next", "child"]);
  });

  it("fails closed for multiple active speakers", () => {
    const session = unsortedSession();
    session.segments[2].timing = {
      ...session.segments[2].timing!,
      activeSpeakerIds: ["speaker_1", "speaker_2"],
    };

    expect(orderSessionSegmentsChronologically(session.segments)
      .map((segment) => segment.id))
      .toEqual(["parent", "next", "child"]);
  });
});

function unsortedSession(): SessionRecord {
  return {
    id: "session_1",
    userId: "guest-user",
    mode: "meeting",
    status: "ended",
    consumedSeconds: 10,
    createdAt: "2026-08-30T00:00:00.000Z",
    segments: [
      segment("parent", "speaker_1", 0, 1_000),
      segment("next", "speaker_2", 1_400, 2_200),
      segment("child", "speaker_2", 1_000, 1_600),
    ],
  };
}

function segment(
  id: string,
  speakerId: string,
  startMs: number,
  endMs: number,
) {
  return {
    id,
    sourceText: id,
    translatedText: `translated ${id}`,
    speaker: {
      speakerId,
      role: "speaker" as const,
      source: "diarization" as const,
    },
    timing: {
      startMs,
      endMs,
      source: "model" as const,
    },
  };
}
