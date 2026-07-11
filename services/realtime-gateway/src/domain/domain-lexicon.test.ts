import { describe, expect, it } from "vitest";
import {
  asrCorrectionTermsForPacks,
  asrHotwordsForTerminology,
  mergeTerminologyWithDomainPacks,
  parseDomainLexiconPacks,
} from "./domain-lexicon.js";

describe("domain lexicon", () => {
  it("adds selected industry packs to server-side sessions", () => {
    const packs = ["product", "business", "technology", "medical"] as const;
    const terms = mergeTerminologyWithDomainPacks([], packs);
    const corrections = asrCorrectionTermsForPacks(packs);
    const hotwords = asrHotwordsForTerminology(terms, corrections);

    expect(terms.some((term) => term.sourceText === "Qwen3 ASR")).toBe(true);
    expect(terms.some((term) => term.sourceText === "行动项")).toBe(true);
    expect(terms.some((term) => term.sourceText === "数据库")).toBe(true);
    expect(terms.some((term) => term.sourceText === "甲状腺")).toBe(true);
    expect(terms.some((term) => term.sourceText === "筑基丹")).toBe(false);
    expect(hotwords).toContain("Hy-MT2");
    expect(hotwords).toContain("客单价");
    expect(hotwords).toContain("网关");
    expect(hotwords).toContain("甲状腺");
  });

  it("keeps user terms and exposes ASR correction pairs", () => {
    const terms = mergeTerminologyWithDomainPacks([{
      id: "user-term-1",
      sourceText: "玄铁令",
      translatedText: "Black Iron Token",
      sourceLanguage: "zh",
      targetLanguage: "en",
      status: "active",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }], ["cultivation"]);

    expect(terms[0]?.sourceText).toBe("玄铁令");
    expect(asrCorrectionTermsForPacks(["cultivation"])).toContainEqual({
      fromText: "助机单",
      toText: "筑基丹",
    });
    expect(asrCorrectionTermsForPacks(["entertainment"])).toContainEqual({
      fromText: "点票号",
      toText: "检票口",
    });
    expect(asrCorrectionTermsForPacks(["medical"])).toContainEqual({
      fromText: "甲状线",
      toText: "甲状腺",
    });
  });

  it("parses comma-separated industry packs with default fallback", () => {
    expect(parseDomainLexiconPacks("business, technology, medical, travel, dining, entertainment")).toEqual([
      "business",
      "technology",
      "medical",
      "travel",
      "dining",
      "entertainment",
    ]);
    expect(parseDomainLexiconPacks("unknown")).toEqual(["product"]);
  });
});
