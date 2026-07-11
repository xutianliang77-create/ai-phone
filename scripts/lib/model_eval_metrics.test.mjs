import { describe, expect, it } from "vitest";
import {
  charErrorRate,
  levenshteinDistance,
  translationSimilarity,
  wordErrorRate,
} from "./model_eval_metrics.mjs";

describe("model eval metrics", () => {
  it("computes character and word error rates", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(charErrorRate("你好世界", "你好")).toBe(0.5);
    expect(wordErrorRate("what is your name", "what your name")).toBe(0.25);
  });

  it("scores CJK word error rate at character granularity", () => {
    expect(wordErrorRate(
      "今天下午三点我们在会议室讨论产品计划。",
      "今天下午三点，我们在会议室讨论产品计划。",
    )).toBe(0);
    expect(wordErrorRate("你好世界", "你好")).toBe(0.5);
  });

  it("computes translation similarity from character error rate", () => {
    expect(translationSimilarity("hello", "hello")).toBe(1);
    expect(translationSimilarity("hello", "hallo")).toBe(0.8);
  });
});
