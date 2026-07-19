import { describe, expect, it } from "vitest";
import { transcriptVariantsForTranslation } from "./transcript-chunks.js";

describe("transcript chunks", () => {
  it("keeps a mixed turn whole and uses its dominant language", () => {
    const variants = transcriptVariantsForTranslation(
      {
        segmentId: "seg_1",
        text: "What's your name? 你叫什么名字呀",
        language: "zh",
      },
      true,
      true,
    );

    expect(variants).toMatchObject([
      {
        segmentId: "seg_1",
        text: "What's your name? 你叫什么名字呀",
        language: "en",
        dominantLanguage: "en",
        detectedLanguages: ["zh", "en"],
        mixedLanguage: true,
      },
    ]);
  });

  it("uses text script to recover English when ASR language is wrong", () => {
    const variants = transcriptVariantsForTranslation(
      {
        segmentId: "seg_1",
        text: "NICE TO MEET YOU",
        language: "zh",
      },
      true,
      true,
    );

    expect(variants).toMatchObject([
      { segmentId: "seg_1", text: "NICE TO MEET YOU", language: "en" },
    ]);
  });

  it("keeps fixed source language even when terms contain English letters", () => {
    const variants = transcriptVariantsForTranslation(
      {
        segmentId: "seg_1",
        text: "测试 FireRedASR2 Hy-MT2 VoxCPM2",
        language: "zh",
      },
      true,
      false,
    );

    expect(variants).toMatchObject([
      {
        segmentId: "seg_1",
        text: "测试 FireRedASR2 Hy-MT2 VoxCPM2",
        language: "zh",
        dominantLanguage: "zh",
        detectedLanguages: ["zh"],
        mixedLanguage: false,
      },
    ]);
  });

  it("keeps model names protected inside one mixed turn", () => {
    const variants = transcriptVariantsForTranslation(
      {
        segmentId: "seg_1",
        text: "Nice to meet you. 我们要测试 Kun3 ASR、HiMT2 和 VoxCPM2 的在线模型链路。",
        language: "zh",
      },
      true,
      true,
    );

    expect(variants).toMatchObject([
      {
        segmentId: "seg_1",
        text: "Nice to meet you. 我们要测试 Kun3 ASR、HiMT2 和 VoxCPM2 的在线模型链路。",
        language: "zh",
        mixedLanguage: true,
      },
    ]);
  });
});
