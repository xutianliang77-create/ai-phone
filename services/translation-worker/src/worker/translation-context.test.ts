import { describe, expect, it } from "vitest";
import {
  CallTranslationContextStore,
  extractProtectedEntities,
  stripRepeatedContextPrefix,
} from "./translation-context.js";

describe("CallTranslationContextStore", () => {
  it("provides only the previous two same-direction translations", () => {
    const store = new CallTranslationContextStore();
    for (let index = 1; index <= 3; index += 1) {
      store.remember({
        callId: "call_1",
        speakerRole: "host",
        sourceText: `source ${index}`,
        translatedText: `target ${index}`,
        sourceLanguage: "en",
        targetLanguage: "zh",
      });
    }
    expect(store.prepare({
      callId: "call_1",
      speakerRole: "host",
      text: "current",
      sourceLanguage: "en",
      targetLanguage: "zh",
    }).previousSegments).toEqual([
      { sourceText: "source 2", translatedText: "target 2" },
      { sourceText: "source 3", translatedText: "target 3" },
    ]);
  });

  it("selects active matching terminology for the current turn", () => {
    const store = new CallTranslationContextStore([{
      id: "term_1",
      sourceText: "中继",
      translatedText: "trunk",
      sourceLanguage: "zh",
      targetLanguage: "en",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]);
    expect(store.prepare({
      callId: "call_1",
      speakerRole: "guest",
      text: "请检查中继状态",
      sourceLanguage: "zh",
      targetLanguage: "en",
    }).glossary).toEqual([{ sourceText: "中继", translatedText: "trunk" }]);
  });
});

it("extracts phone, money, date and product-code entities", () => {
  expect(extractProtectedEntities(
    "SKU A-120, USD 31.50, +86 138-0013-8000, 2026-07-17",
  )).toEqual(expect.arrayContaining([
    "A-120",
    "USD 31.50",
    "+86 138-0013-8000",
    "2026-07-17",
  ]));
});

it("removes an accidental previous-context echo", () => {
  expect(stripRepeatedContextPrefix(
    "Previous sentence. Current translation.",
    [{ sourceText: "上一句", translatedText: "Previous sentence." }],
  )).toBe("Current translation.");
});
