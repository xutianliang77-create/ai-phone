import { describe, expect, it } from "vitest";
import { SpeakerTurnDiagnostics } from "./speaker-turn-diagnostics.js";

describe("speaker turn diagnostics", () => {
  it("resolves a raw commit miss as endpoint no-op", () => {
    const diagnostics = new SpeakerTurnDiagnostics();
    diagnostics.recordBoundary(
      "sess_1",
      {
        previousSpeakerId: "speaker_1",
        nextSpeakerId: "speaker_2",
        boundaryMs: 5100,
        confirmedAtMs: 5900,
        confidence: 0.9,
        dominanceRatio: 1,
      },
      "miss",
      [],
      0,
    );

    expect(diagnostics.resolveBoundary(
      "sess_1",
      5100,
      "noop_after_endpoint",
    )).toBe(true);
    expect(diagnostics.snapshot("sess_1")).toMatchObject({
      commitMissCount: 1,
      unresolvedCommitMissCount: 0,
      boundaryOutcomeCounts: { noop_after_endpoint: 1 },
    });
  });
});
