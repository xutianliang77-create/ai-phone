import { describe, expect, it } from "vitest";
import {
  asrEvalLexicon,
  asrEvalTermsMissing,
  deriveFlushEndpoint,
  isAsrEvalAcceptable,
  mergeAsrEvalHotwords,
  parseAsrEvalDomainPacks,
  parseAsrEvalMode,
  parseAsrEvalSampleIds,
  parseAsrEvalSourceLanguage,
  requiredAsrEvalEndpoint,
} from "./http_asr_batch_eval.mjs";

describe("HTTP ASR batch eval", () => {
  it("fails acoustically close transcripts when a protected term is missing", () => {
    const sample = { id: "caption", text: "不要把背景声音当成字幕。", terms: ["字幕"] };
    expect(asrEvalTermsMissing(sample.terms, "不要把背景声音当成字母。"))
      .toEqual(["字幕"]);
    expect(isAsrEvalAcceptable(sample, "不要把背景声音当成字母。", 0.025))
      .toBe(false);
  });

  it("does not enforce semantic labels that are not literal source spans", () => {
    expect(asrEvalTermsMissing(
      ["字幕完整"],
      "字幕是否完整。",
      "字幕是否完整。",
    )).toEqual([]);
  });

  it("accepts equivalent identifier and amount formatting", () => {
    expect(asrEvalTermsMissing(
      ["A-120", "twenty thousand yuan"],
      "The order number is A120 and the price is 20,000 yuan.",
    )).toEqual([]);
  });

  it("builds the exact production domain lexicon and rejects unknown packs", () => {
    const packs = parseAsrEvalDomainPacks("product,entertainment");
    const lexicon = asrEvalLexicon(packs);
    expect(packs).toEqual(["product", "entertainment"]);
    expect(lexicon.hotwords).toContain("Hy-MT2");
    expect(lexicon.corrections).toContainEqual({ fromText: "字母", toText: "字幕" });
    expect(() => parseAsrEvalDomainPacks("product,unknown"))
      .toThrow("Unknown ASR eval domain pack: unknown");
  });

  it("keeps raw runs empty and merges sample terms without duplicates", () => {
    expect(asrEvalLexicon([])).toEqual({ hotwords: [], corrections: [] });
    expect(mergeAsrEvalHotwords(["字幕", "Hy-MT2"], ["hy-mt2", "李明"]))
      .toEqual(["字幕", "Hy-MT2", "李明"]);
  });

  it("requires a configured server endpoint and derives the flush route", () => {
    expect(() => requiredAsrEvalEndpoint(undefined))
      .toThrow("ASR_HTTP_ENDPOINT is required");
    const endpoint = requiredAsrEvalEndpoint(
      "https://models.example.cn/asr/transcribe",
    );
    expect(endpoint).toBe("https://models.example.cn/asr/transcribe");
    expect(deriveFlushEndpoint(endpoint))
      .toBe("https://models.example.cn/asr/sessions/:sessionId/flush");
  });

  it("normalizes explicit language routing without silently accepting aliases", () => {
    expect(parseAsrEvalSourceLanguage(undefined)).toBe(null);
    expect(parseAsrEvalSourceLanguage("auto")).toBe("auto");
    expect(parseAsrEvalSourceLanguage("zh-CN")).toBe("zh");
    expect(parseAsrEvalSourceLanguage("en-US")).toBe("en");
    expect(() => parseAsrEvalSourceLanguage("turn"))
      .toThrow("Unsupported ASR eval source language: turn");
  });

  it("validates realtime mode and optional sample filters", () => {
    expect(parseAsrEvalMode(undefined)).toBe("conversation");
    expect(parseAsrEvalMode("call_link")).toBe("call_link");
    expect(() => parseAsrEvalMode("meeting"))
      .toThrow("Unsupported ASR eval mode: meeting");
    expect(parseAsrEvalSampleIds("zh_short_001, mixed_001,zh_short_001"))
      .toEqual(["zh_short_001", "mixed_001"]);
  });
});
