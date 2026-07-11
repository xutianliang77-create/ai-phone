import { describe, expect, test } from "vitest";
import { normalizeOpenAiCompatibleBaseUrl } from "./domestic_release_qwen_checks.mjs";

describe("normalizeOpenAiCompatibleBaseUrl", () => {
  test("removes a trailing v1 segment", () => {
    expect(normalizeOpenAiCompatibleBaseUrl(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )).toBe("https://dashscope.aliyuncs.com/compatible-mode");
  });
});
