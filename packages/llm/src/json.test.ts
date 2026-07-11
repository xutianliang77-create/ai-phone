import { describe, expect, it } from "vitest";
import { parseJsonObject } from "./json.js";

describe("LLM JSON parsing", () => {
  it("uses the final valid JSON object after thinking and examples", () => {
    const value = parseJsonObject(`
      <think>{"optimizedText":"污染结果","confidence":0.1}</think>
      示例：{"optimizedText":"示例","confidence":0.2}
      最终结果：
      {
        "optimizedText": "现在断句不稳定。",
        "confidence": 0.95,
        "operations": ["context_term_correction"],
        "protectedTermsKept": ["断句"],
        "warnings": []
      }
    `) as Record<string, unknown>;

    expect(value).toMatchObject({
      optimizedText: "现在断句不稳定。",
      confidence: 0.95,
    });
  });

  it("skips invalid balanced objects before the final JSON", () => {
    const value = parseJsonObject(`
      {optimizedText:"不是 JSON"}
      {"optimizedText":"最终文本","confidence":0.9}
    `) as Record<string, unknown>;

    expect(value.optimizedText).toBe("最终文本");
  });
});
