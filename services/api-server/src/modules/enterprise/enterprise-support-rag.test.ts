import { describe, expect, it } from "vitest";
import { enterpriseSupportRagResponse } from "./enterprise-support-rag.js";

describe("enterprise support RAG response", () => {
  it("returns only citation-backed evidence", () => {
    const evidence = [{
      knowledgeVersionId: "knowledge-version", sourceId: "source", revision: 3,
      blockId: "shipping", content: "Ships in two days", contentHash: "a".repeat(64),
      citation: "knowledge-version:shipping",
    }];
    expect(enterpriseSupportRagResponse({
      sessionId: "session", locale: "en-US", results: evidence,
    })).toEqual({ status: "grounded", sessionId: "session",
      directive: "answer_with_citations", evidence });
  });

  it("does not invent an answer when no evidence exists", () => {
    const result = enterpriseSupportRagResponse({
      sessionId: "session", locale: "zh-CN", results: [],
    });
    expect(result).toEqual({
      status: "no_evidence", sessionId: "session",
      directive: "state_uncertain_and_offer_handoff",
      message: "无法从已审核的企业知识中确认。可以为您转接人工客服。",
      handoffRecommended: true, evidence: [],
    });
  });
});
