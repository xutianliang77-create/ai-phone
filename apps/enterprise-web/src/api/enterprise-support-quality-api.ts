import type { EnterpriseContentRequestContext } from "./enterprise-api.js";

type EnterpriseRequester = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface EnterpriseSupportQualityRuleVersionDto {
  id: string; revision: number; engineVersion: string; locale: string;
  identityDisclosurePhrases: string[]; prohibitedPromisePhrases: string[];
  publishedAt: string; version: number;
}
export type EnterpriseSupportQualityFindingCode =
  "identity_disclosure_missing" | "answer_without_citation" |
  "risk_without_handoff" | "prohibited_promise" | "response_not_delivered";
export interface EnterpriseSupportQualityReviewDto {
  id: string; supportSessionId: string; runId: string; ruleVersionId: string;
  engineVersion: string; sourceHash: string; status: "complete" | "partial";
  semanticStatus: "ready" | "not_configured" | "failed";
  semanticReasonCode?: string; evaluatedTurnCount: number;
  evaluatedRuleCount: number; findingCount: number; criticalCount: number;
  highCount: number; mediumCount: number; analyzedAt: string; version: number;
}
export interface EnterpriseSupportQualityDashboardDto {
  reviewCount: number; findingCount: number; criticalCount: number;
  highCount: number; mediumCount: number; disclosureMissingSessionCount: number;
  unsupportedAnswerCount: number; semanticIncorrectAnswerRate: null;
  semanticStatus: "not_configured"; semanticReasonCode: string;
  latestAnalyzedAt?: string;
}
export interface EnterpriseSupportQualityDetailDto {
  review: EnterpriseSupportQualityReviewDto;
  ruleVersion: EnterpriseSupportQualityRuleVersionDto;
  findings: Array<{ id: string; turnId: string; turnSequence: number;
    code: EnterpriseSupportQualityFindingCode;
    severity: "critical" | "high" | "medium"; evidenceHash: string;
    createdAt: string }>;
  session: { id: string; status: string; createdAt: string;
    updatedAt: string; endedAt?: string };
  run: { id: string; status: string; locale: string; generation: number };
  turns: Array<{ id: string; sequence: number; status: string;
    output?: { spokenText: string; intent: string; riskSignals: string[];
      knowledgeCitations: string[]; conversationState: string };
    failureCode?: string; evidenceHash: string; deliveredAt?: string;
    createdAt: string; updatedAt: string; version: number }>;
  transcriptSegments: Array<{ segmentId: string; revision: number;
    sourceText: string; translatedText?: string; speakerRole?: string;
    startMs?: number; createdAt: string; updatedAt: string }>;
  toolExecutions: Array<{ id: string; toolName: string; riskLevel: string;
    confirmationStatus: string; status: string; failureCode?: string;
    createdAt: string; completedAt?: string }>;
}

export interface EnterpriseSupportQualityApi {
  listSupportQualityRuleVersions(context: EnterpriseContentRequestContext): Promise<{
    ruleVersions: EnterpriseSupportQualityRuleVersionDto[] }>;
  publishSupportQualityRuleVersion(context: EnterpriseContentRequestContext,
    input: { locale: string; identityDisclosurePhrases: string[];
      prohibitedPromisePhrases: string[]; idempotencyKey: string }): Promise<{
        status: "published" | "replayed";
        ruleVersion: EnterpriseSupportQualityRuleVersionDto }>;
  getSupportQualityDashboard(context: EnterpriseContentRequestContext): Promise<{
    dashboard: EnterpriseSupportQualityDashboardDto;
    sessions: Array<{ review: EnterpriseSupportQualityReviewDto;
      findingCodes: EnterpriseSupportQualityFindingCode[] }> }>;
  analyzeSupportQualitySession(context: EnterpriseContentRequestContext,
    sessionId: string): Promise<{ status: "analyzed" | "replayed";
      review: EnterpriseSupportQualityReviewDto }>;
  getSupportQualitySession(context: EnterpriseContentRequestContext,
    sessionId: string): Promise<EnterpriseSupportQualityDetailDto>;
}

export function createEnterpriseSupportQualityApi(
  request: EnterpriseRequester,
  headers: (context: EnterpriseContentRequestContext) => Record<string, string>,
): EnterpriseSupportQualityApi {
  const quality = "/enterprise/v1/support/quality";
  return {
    listSupportQualityRuleVersions: (context) => request(`${quality}/rule-versions`, {
      headers: headers(context),
    }),
    publishSupportQualityRuleVersion: (context, input) => request(
      `${quality}/rule-versions`, { method: "POST", headers: headers(context),
        body: JSON.stringify(input) }),
    getSupportQualityDashboard: (context) => request(`${quality}/dashboard`, {
      headers: headers(context),
    }),
    analyzeSupportQualitySession: (context, sessionId) => request(
      `${quality}/sessions/${encodeURIComponent(sessionId)}/analyses`,
      { method: "POST", headers: headers(context) }),
    getSupportQualitySession: (context, sessionId) => request(
      `${quality}/sessions/${encodeURIComponent(sessionId)}`,
      { headers: headers(context) }),
  };
}
