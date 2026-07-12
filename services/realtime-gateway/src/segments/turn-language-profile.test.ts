import { describe, expect, it } from "vitest";
import { analyzeTurnLanguage } from "./turn-language-profile.js";

describe("turn language profile", () => {
  it("does not treat protected model names as English speech", () => {
    expect(analyzeTurnLanguage(
      "使用 Qwen3-ASR、Hy-MT2、VoxCPM2 和 ASR API。",
      "zh",
    )).toEqual({
      dominantLanguage: "zh",
      detectedLanguages: ["zh"],
      mixedLanguage: false,
    });
  });

  it("detects a real Chinese and English mixed turn", () => {
    expect(analyzeTurnLanguage(
      "请介绍一下 yourself and the product plan.",
      "zh",
    )).toEqual({
      dominantLanguage: "en",
      detectedLanguages: ["zh", "en"],
      mixedLanguage: true,
    });
  });

  it("recovers pure English from incorrect ASR metadata", () => {
    expect(analyzeTurnLanguage("NICE TO MEET YOU", "zh")).toEqual({
      dominantLanguage: "en",
      detectedLanguages: ["en"],
      mixedLanguage: false,
    });
  });

  it("keeps a non-Chinese and non-English ASR language authoritative", () => {
    expect(analyzeTurnLanguage("Bonjour tout le monde", "fr")).toEqual({
      dominantLanguage: "fr",
      detectedLanguages: ["fr"],
      mixedLanguage: false,
    });
  });
});
