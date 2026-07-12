import { describe, expect, it } from "vitest";
import { orderedTurnTranscripts } from "./transcript-turn-order.js";

describe("turn transcript ordering", () => {
  it("orders by audio start and keeps only the highest segment revision", () => {
    const ordered = orderedTurnTranscripts([
      transcript("second", 1000, 0),
      transcript("first", 0, 0),
      { ...transcript("first", 0, 1), text: "revised first" },
    ]);

    expect(ordered.map((item) => [item.segmentId, item.revision, item.text]))
      .toEqual([
        ["first", 1, "revised first"],
        ["second", 0, "second"],
      ]);
  });

  it("does not invent turn metadata for legacy providers", () => {
    const [legacy] = orderedTurnTranscripts([transcript("legacy", 0)]);
    expect(legacy).not.toHaveProperty("turnId");
    expect(legacy).not.toHaveProperty("revision");
  });
});

function transcript(segmentId: string, startMs: number, revision?: number) {
  return {
    segmentId,
    text: segmentId,
    language: "en" as const,
    ...(revision === undefined ? {} : { revision }),
    timing: { startMs, endMs: startMs + 500, source: "client" as const },
  };
}
