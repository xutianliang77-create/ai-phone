import type {
  EnterpriseKnowledgeSearchResultDto,
  EnterpriseSupportRagResponse,
} from "@translation/contracts";

export function enterpriseSupportRagResponse(input: {
  sessionId: string;
  locale: string;
  results: EnterpriseKnowledgeSearchResultDto[];
}): EnterpriseSupportRagResponse {
  if (input.results.length > 0) {
    return {
      status: "grounded",
      sessionId: input.sessionId,
      directive: "answer_with_citations",
      evidence: input.results,
    };
  }
  return {
    status: "no_evidence",
    sessionId: input.sessionId,
    directive: "state_uncertain_and_offer_handoff",
    message: chinese(input.locale)
      ? "无法从已审核的企业知识中确认。可以为您转接人工客服。"
      : "I cannot confirm this from approved company knowledge. I can connect you to a human agent.",
    handoffRecommended: true,
    evidence: [],
  };
}

function chinese(locale: string) {
  return locale.trim().toLowerCase().startsWith("zh");
}
