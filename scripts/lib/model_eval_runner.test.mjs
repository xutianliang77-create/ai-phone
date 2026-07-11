import { describe, expect, it } from "vitest";
import { evaluateModelFixture } from "./model_eval_runner.mjs";

describe("model eval runner", () => {
  it("passes a complete fixture within thresholds", () => {
    const result = evaluateModelFixture({
      cases: [
        {
          id: "asr-ok",
          type: "asr",
          group: "zh_short",
          provider: "provider-a",
          model: "asr-model",
          expectedLanguage: "zh",
          actualLanguage: "zh",
          languageConfidence: 0.95,
          expectedText: "你好世界",
          actualText: "你好世界",
        },
        {
          id: "translation-ok",
          type: "translation",
          group: "terms",
          provider: "provider-a",
          model: "translation-model",
          expectedText: "hello",
          actualText: "hello",
          protectedTerms: ["hello"],
        },
        {
          id: "tts-ok",
          type: "tts",
          group: "tts_phone",
          provider: "provider-a",
          model: "tts-model",
          producedAudio: true,
          firstAudioMs: 300,
          phoneBandScore: 4.2,
        },
      ],
      requiredGroups: ["zh_short", "terms", "tts_phone"],
      requirements: { languageConfidence: true },
    });

    expect(result.status).toBe("ready");
    expect(result.issues).toEqual([]);
    expect(result.coverage.missing).toEqual([]);
    expect(result.summary[0].total).toBe(1);
  });

  it("fails cases that exceed thresholds", () => {
    const result = evaluateModelFixture({
      cases: [
        {
          id: "asr-bad",
          type: "asr",
          provider: "provider-a",
          model: "asr-model",
          expectedLanguage: "zh",
          actualLanguage: "en",
          expectedText: "你好世界",
          actualText: "hello world",
        },
      ],
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues[0]).toContain("asr-bad");
  });

  it("fails missing required groups and ASR confidence", () => {
    const result = evaluateModelFixture({
      requiredGroups: ["zh_fast", "code_switch"],
      requirements: { languageConfidence: true },
      cases: [
        {
          id: "asr-no-confidence",
          type: "asr",
          group: "zh_fast",
          provider: "provider-a",
          model: "asr-model",
          expectedLanguage: "zh",
          actualLanguage: "zh",
          expectedText: "今天我们测试中文快语速",
          actualText: "今天我们测试中文快语速",
        },
      ],
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues).toContain("missing required model eval group: code_switch");
    expect(result.issues.join("\n")).toContain("asr language confidence missing");
  });

  it("fails translation protected terms and high latency", () => {
    const result = evaluateModelFixture({
      cases: [
        {
          id: "translation-loses-terms",
          type: "translation",
          provider: "provider-a",
          model: "translation-model",
          expectedText: "The quote for SKU A-120 is 20,000 yuan.",
          actualText: "The quote is expensive.",
          protectedTerms: ["A-120", "20,000 yuan"],
          latencyMs: 5000,
        },
      ],
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues[0]).toContain("translation latency too high");
    expect(result.issues[0]).toContain("A-120");
  });

  it("fails low TTS phone-band intelligibility", () => {
    const result = evaluateModelFixture({
      cases: [
        {
          id: "tts-muffled",
          type: "tts",
          provider: "provider-a",
          model: "tts-model",
          producedAudio: true,
          firstAudioMs: 300,
          phoneBandScore: 2.5,
        },
      ],
    });

    expect(result.status).toBe("not_ready");
    expect(result.issues[0]).toContain("tts phone-band intelligibility too low");
  });

  it("treats missing TTS phone-band score as unscored", () => {
    const result = evaluateModelFixture({
      cases: [
        {
          id: "tts-unscored",
          type: "tts",
          provider: "provider-a",
          model: "tts-model",
          producedAudio: true,
          firstAudioMs: 300,
          phoneBandScore: null,
        },
      ],
    });

    expect(result.status).toBe("ready");
    expect(result.results[0].metrics.phoneBandScore).toBeNull();
  });
});
