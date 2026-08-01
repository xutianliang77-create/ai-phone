import { describe, expect, it } from "vitest";
import { SpeakerTurnAssignment } from "./speaker-turn-assignment.js";

describe("speaker turn assignment", () => {
  it("preserves an ASR segment revision while assigning the turn", () => {
    const assignment = new SpeakerTurnAssignment();

    expect(assignment.assign({
      segmentId: "qwen17_1",
      revision: 7,
      text: "完整识别结果",
      language: "zh",
    }, assignment.current("sess_1"))).toMatchObject({
      segmentId: "qwen17_1",
      turnId: "turn_1",
      revision: 7,
    });
  });

  it("uses the turn revision for legacy ASR results without one", () => {
    const assignment = new SpeakerTurnAssignment();

    expect(assignment.assign({
      segmentId: "legacy_1",
      text: "legacy result",
      language: "en",
    }, assignment.current("sess_1"))).toMatchObject({
      segmentId: "legacy_1",
      turnId: "turn_1",
      revision: 0,
    });
  });
});
