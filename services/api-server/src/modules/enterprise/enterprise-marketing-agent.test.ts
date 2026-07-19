import { describe, expect, it } from "vitest";
import type { EnterpriseMarketingAgentProviderInput } from
  "./enterprise-marketing-agent.js";
import { enterpriseMarketingAgentDeterministicIntent,
  enterpriseMarketingAgentFallback, validateEnterpriseMarketingAgentOutput } from
  "./enterprise-marketing-agent.js";

describe("Enterprise Marketing Agent guard", () => {
  it("matches configured opt-out before model generation", () => {
    expect(enterpriseMarketingAgentDeterministicIntent(
      "谢谢，我不感兴趣。", input().profile)).toBe("opt_out");
    expect(enterpriseMarketingAgentDeterministicIntent(
      "Please connect a HUMAN AGENT", input().profile)).toBe("handoff");
  });

  it("allows only exact configured qualification questions without evidence", () => {
    const first = input(); first.evidence = [];
    const value = { spokenText: "How many team members need access?",
      intent: "qualify", conversationState: "qualifying", action: "continue",
      riskSignals: [], knowledgeCitations: [] };
    expect(validateEnterpriseMarketingAgentOutput(value, first)).toEqual(value);
    expect(validateEnterpriseMarketingAgentOutput({ ...value,
      spokenText: "How large is your team?" }, first)).toBeNull();
    const second = input();
    second.profile.qualificationQuestions.push("Which region do you serve?");
    second.recentTurns.push({ role: "assistant",
      text: "How many team members need access?" });
    expect(validateEnterpriseMarketingAgentOutput({ ...value,
      spokenText: "Which region do you serve?" }, second)).not.toBeNull();
    expect(validateEnterpriseMarketingAgentOutput(value, second)).toBeNull();
  });

  it("rejects factual answers without an approved citation or with prohibited promises", () => {
    const value = { spokenText: "The approved plan includes team access.",
      intent: "inform", conversationState: "presenting", action: "continue",
      riskSignals: [], knowledgeCitations: [] };
    expect(validateEnterpriseMarketingAgentOutput(value, input())).toBeNull();
    expect(validateEnterpriseMarketingAgentOutput({ ...value,
      spokenText: "We promise a legal outcome.", knowledgeCitations: ["version:block"] },
    input())).toBeNull();
    expect(validateEnterpriseMarketingAgentOutput({ ...value,
      spokenText: "Your demo has been scheduled successfully.",
      knowledgeCitations: ["version:block"] }, input())).toBeNull();
  });

  it("degrades honestly without claiming a human transfer succeeded", () => {
    expect(enterpriseMarketingAgentFallback({ locale: "en-US", kind: "handoff",
      reasonCode: "marketing_agent_handoff_not_configured" }))
      .toMatchObject({ action: "handoff", intent: "handoff",
        spokenText: expect.stringContaining("not available") });
  });
});

function input(): EnterpriseMarketingAgentProviderInput {
  return { locale: "en-US", customerText: "question", recentTurns: [],
    conversationState: "qualifying", evidence: [{
      knowledgeVersionId: "00000000-0000-4000-8000-000000000001",
      sourceId: "00000000-0000-4000-8000-000000000002", revision: 1,
      blockId: "block", content: "Approved team access.",
      contentHash: "a".repeat(64), citation: "version:block" }],
    profile: { id: "00000000-0000-4000-8000-000000000003",
      campaignId: "00000000-0000-4000-8000-000000000004", countryCode: "US",
      locale: "en-US", brandName: "Wujie AI", agentIdentity: "AI marketing agent",
      callPurpose: "product introduction",
      productCode: "enterprise", valueProposition: "Approved value",
      targetMarket: "Enterprise teams",
      termPackId: "00000000-0000-4000-8000-000000000005",
      scriptTemplateId: "00000000-0000-4000-8000-000000000006",
      voicePresetId: "voice-en", openingDisclosure: "AI disclosure",
      qualificationQuestions: ["How many team members need access?"],
      optOutPhrases: ["not interested", "不感兴趣"],
      handoffPhrases: ["human agent", "转人工"], closingText: "Goodbye",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z", version: 1 },
    terminology: { contextHash: "b".repeat(64),
      termPackVersionId: "00000000-0000-4000-8000-000000000007",
      scriptTemplateVersionId: "00000000-0000-4000-8000-000000000008",
      asr: { termPackVersionId: "00000000-0000-4000-8000-000000000007" },
      translation: { termPackVersionId: "00000000-0000-4000-8000-000000000007" },
      llm: { termPackVersionId: "00000000-0000-4000-8000-000000000007",
        scriptTemplateVersionId: "00000000-0000-4000-8000-000000000008" },
      terms: [], script: { promptText: "Approved only",
        requiredPhrases: [], prohibitedPhrases: ["guarantee a refund"], variables: [] } } };
}
