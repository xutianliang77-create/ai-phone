export type EnterpriseMarketingSuppressionScope = "tenant" | "global";

export type EnterpriseMarketingSuppressionSource =
  | "manual"
  | "contact_request"
  | "consent_withdrawal"
  | "complaint"
  | "global_registry";

export type EnterpriseGlobalSuppressionRegistryStatus =
  | "ready"
  | "not_configured"
  | "degraded";

export interface CreateEnterpriseMarketingSuppressionRequest {
  tenantId?: string;
  campaignId: string;
  leadId: string;
  scope: "tenant";
  source: Exclude<EnterpriseMarketingSuppressionSource, "global_registry">;
  reason: string;
  sourceReference: string;
}

export interface EnterpriseMarketingSuppressionDto {
  id: string;
  leadId: string;
  phoneHint: string;
  scope: EnterpriseMarketingSuppressionScope;
  source: EnterpriseMarketingSuppressionSource;
  reason: string;
  sourceReference: string;
  createdBy: string;
  createdAt: string;
  cancelledTaskCount: number;
  version: number;
}

export interface EnterpriseGlobalSuppressionRegistryReadiness {
  status: EnterpriseGlobalSuppressionRegistryStatus;
  reasonCode?: string;
}

export interface EnterpriseMarketingSuppressionsResponse {
  evaluatedAt: string;
  suppressions: EnterpriseMarketingSuppressionDto[];
  globalRegistry: EnterpriseGlobalSuppressionRegistryReadiness;
}

export type EnterpriseMarketingSuppressionEligibilityResponse =
  | {
      status: "blocked";
      evaluatedAt: string;
      reasonCode: "tenant_suppressed" | "global_suppressed";
      suppression: EnterpriseMarketingSuppressionDto;
      globalRegistry: EnterpriseGlobalSuppressionRegistryReadiness;
    }
  | {
      status: "not_ready";
      evaluatedAt: string;
      reasonCode: "global_suppression_registry_not_configured" |
        "global_suppression_registry_degraded";
      globalRegistry: EnterpriseGlobalSuppressionRegistryReadiness;
    }
  | {
      status: "eligible";
      evaluatedAt: string;
      globalRegistry: EnterpriseGlobalSuppressionRegistryReadiness;
    };

export interface EnterpriseMarketingSuppressionResponse {
  status: "created" | "replayed" | "already_suppressed";
  suppression: EnterpriseMarketingSuppressionDto;
}
