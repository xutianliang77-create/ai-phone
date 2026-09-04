import { describe, expect, it } from "vitest";
import type { AsrTokenTimingDto } from "@translation/contracts";

import { SegmentAssembler } from "./segment-assembler.js";
import type { SpeechTranscript } from "./speech-transcript.js";

describe("max-duration continuation token timing", () => {
  it("merges absolute token times and rebases character ranges", () => {
    const assembler = revisionAssembler();
    assembler.push("sess_1", transcript(
      "seg_1",
      "我会整。",
      "max_duration",
      0,
      6000,
      characterTimings("我会整。", 0),
    ), 1000);

    const revised = assembler.push("sess_1", transcript(
      "seg_2",
      "整理会议纪要。",
      "silence",
      6001,
      9000,
      characterTimings("整理会议纪要。", 6001),
    ), 3000).ready[0];

    expect(revised.text).toBe("我会整理会议纪要。");
    expect(revised.tokenTimings?.map((token) => token.text).join(""))
      .toBe("我会整理会议纪要");
    expect(revised.tokenTimings?.every((token) =>
      revised.text.slice(token.characterStart, token.characterEnd) ===
        token.text
    )).toBe(true);
    expect(revised.tokenTimings?.every((token, index, tokens) =>
      index === 0 || token.startMs >= tokens[index - 1].startMs
    )).toBe(true);
  });

  it("drops the merged timing contract when a contributing part has none", () => {
    const assembler = revisionAssembler();
    assembler.push("sess_1", transcript(
      "seg_1",
      "我会整。",
      "max_duration",
      0,
      6000,
      characterTimings("我会整。", 0),
    ), 1000);

    const revised = assembler.push("sess_1", transcript(
      "seg_2",
      "整理会议纪要。",
      "silence",
      6001,
      9000,
    ), 3000).ready[0];

    expect(revised).not.toHaveProperty("tokenTimings");
  });
});

function revisionAssembler() {
  return new SegmentAssembler({
    emitMaxDurationRevisions: true,
    maxContinuationBufferMs: 7500,
  });
}

function transcript(
  segmentId: string,
  text: string,
  endpointReason: "max_duration" | "silence",
  startMs: number,
  endMs: number,
  tokenTimings?: AsrTokenTimingDto[],
): SpeechTranscript {
  return {
    segmentId,
    turnId: "turn_1",
    text,
    language: "zh",
    endpointReason,
    speaker: {
      speakerId: "speaker_1",
      role: "speaker",
      source: "diarization",
    },
    timing: { startMs, endMs, source: "client" },
    ...(tokenTimings ? { tokenTimings } : {}),
  };
}

function characterTimings(text: string, startMs: number) {
  return Array.from(text).flatMap((character, index) =>
    /[，。,.]/u.test(character)
      ? []
      : [{
          text: character,
          startMs: startMs + index * 80,
          endMs: startMs + (index + 1) * 80,
          characterStart: index,
          characterEnd: index + 1,
        }]
  );
}
