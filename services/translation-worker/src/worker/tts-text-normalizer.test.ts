import { describe, expect, it } from "vitest";
import { normalizeTtsText } from "./tts-text-normalizer.js";

describe("normalizeTtsText", () => {
  it("normalizes Chinese speech text without changing ordinary prose", () => {
    expect(normalizeTtsText("订单 A-120 金额 ¥31.50，电话 138-0013-8000。", "zh"))
      .toBe("订单 A 幺 二 零 金额 31.50元，电话 幺三八 零零幺三 八零零零。");
  });

  it("normalizes English speech text for product codes, money and phone numbers", () => {
    expect(normalizeTtsText("Order SKU A-120 costs $31.50, call 138-0013-8000.", "en"))
      .toBe("Order SKU A one two zero costs 31.50 dollars, call one three eight zero zero one three eight zero zero zero.");
  });

  it("does not spell date-like values as phone numbers", () => {
    expect(normalizeTtsText("会议日期是 2026-07-05。", "zh"))
      .toBe("会议日期是 2026-07-05。");
  });
});
