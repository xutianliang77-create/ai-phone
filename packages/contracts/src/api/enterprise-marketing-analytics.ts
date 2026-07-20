export type EnterpriseMarketingAnalyticsFunnelStage =
  | "active_leads"
  | "scheduled_tasks"
  | "provider_accepted"
  | "answered_calls"
  | "finalized_outcomes";

export interface EnterpriseMarketingAnalyticsUsageDto {
  category: string;
  unit: "seconds" | "frames" | "characters" | "tokens";
  settledAmount: number;
  adjustmentAmount: number;
  netAmount: number;
  eventCount: number;
}

export interface EnterpriseMarketingAnalyticsCountsDto {
  activeLeads: number;
  scheduledTasks: number;
  providerAccepted: number;
  answeredCalls: number;
  finalizedOutcomes: number;
  positiveInterestOutcomes: number;
  nextActionsRequested: number;
  crmReconciled: number;
  explicitComplaints: number;
}

export interface EnterpriseMarketingAnalyticsCountryDto {
  countryCode: string;
  counts: EnterpriseMarketingAnalyticsCountsDto;
  usage: EnterpriseMarketingAnalyticsUsageDto[];
}

export interface EnterpriseMarketingAnalyticsVersionDto {
  profileVersion: number;
  termPackVersionId: string;
  scriptTemplateVersionId: string;
  agentProviderFingerprint: string;
  pstnProvider: "pstn_http" | "pstn_fonoster";
  pstnProviderFingerprint: string;
  runCount: number;
  answeredCalls: number;
  finalizedOutcomes: number;
  positiveInterestOutcomes: number;
  crmReconciled: number;
  sessionAttributedComplaints: number;
  usage: EnterpriseMarketingAnalyticsUsageDto[];
}

export interface EnterpriseMarketingAnalyticsResponse {
  campaignId: string;
  generatedAt: string;
  sampleStatus: "available" | "no_call_samples";
  counts: EnterpriseMarketingAnalyticsCountsDto;
  funnel: Array<{
    stage: EnterpriseMarketingAnalyticsFunnelStage;
    count: number;
    rateFromPrevious: number | null;
  }>;
  outcomes: {
    dispositions: Array<{ disposition: string; count: number }>;
    intents: Array<{ intentLevel: string; count: number }>;
  };
  complaints: {
    explicitCount: number;
    sessionAttributedCount: number;
    attribution: "origin_campaign";
    ratePerAnsweredCall: number | null;
  };
  cost: {
    usage: EnterpriseMarketingAnalyticsUsageDto[];
    monetary: {
      status: "not_configured";
      amount: null;
      currency: null;
      reasonCode: "pricing_not_configured";
    };
  };
  breakdowns: {
    countries: EnterpriseMarketingAnalyticsCountryDto[];
    executionVersions: EnterpriseMarketingAnalyticsVersionDto[];
  };
  evidence: {
    snapshot: "repeatable_read";
    outcomeEvidence: "verified_only";
    complaintEvidence: "explicit_suppression_only";
    externalSuccess: "reconciled_receipt_only";
  };
}
