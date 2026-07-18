import { describe, expect, it } from "vitest";
import {
  createEnterpriseRuntimeContext,
  prepareEnterpriseTerms,
  validateEnterpriseTermDimensions,
} from "./enterprise-terminology.js";
import {
  prepareEnterpriseScriptContent,
} from "./enterprise-script-template.js";

const terms = [{
  termId: "wujie", sourceText: "无界AI", translatedText: "Wujie AI",
  aliases: ["无界"], pronunciation: "wu jie", caseSensitive: false, protected: true,
}];

describe("enterprise terminology domain", () => {
  it("normalizes dimensions and creates stable term content hashes", () => {
    expect(validateEnterpriseTermDimensions({
      sourceLocale: "zh-CN", targetLocale: "en-US", countryCode: "cn",
      productCode: "PHONE-PRO", usageScope: "support",
    })).toEqual({
      sourceLocale: "zh-CN", targetLocale: "en-US", countryCode: "CN",
      productCode: "phone-pro", usageScope: "support",
    });
    expect(prepareEnterpriseTerms(terms).contentHash)
      .toBe(prepareEnterpriseTerms(structuredClone(terms)).contentHash);
  });

  it("rejects duplicate normalized terms and conflicting script phrases", () => {
    expect(() => prepareEnterpriseTerms([
      ...terms,
      { ...terms[0]!, termId: "other", sourceText: "无界ai" },
    ])).toThrow("Duplicate enterprise term");
    expect(() => prepareEnterpriseScriptContent({
      promptText: "Follow policy", requiredPhrases: ["我是AI助手"],
      prohibitedPhrases: ["我是ai助手"], variables: [],
    })).toThrow("both required and prohibited");
  });

  it("binds ASR, translation and LLM to one term pack version", () => {
    const runtime = createEnterpriseRuntimeContext({
      termPackVersionId: "term-version-1", termContentHash: "a".repeat(64),
      terms, scriptTemplateVersionId: "script-version-1",
      scriptContentHash: "b".repeat(64),
      script: {
        promptText: "Follow policy", requiredPhrases: [],
        prohibitedPhrases: [], variables: [],
      },
    });
    expect(new Set([
      runtime.termPackVersionId, runtime.asr.termPackVersionId,
      runtime.translation.termPackVersionId, runtime.llm.termPackVersionId,
    ])).toEqual(new Set(["term-version-1"]));
    expect(runtime.llm.scriptTemplateVersionId).toBe("script-version-1");
    expect(runtime.contextHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
