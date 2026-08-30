import type {
  EnterpriseMarketingCrmProvider,
  EnterpriseMarketingCrmSyncStatus,
} from "./enterprise-marketing-crm.js";
import type {
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
} from "./enterprise-marketing-outcome.js";

export type EnterpriseLeadDirectoryConsentEligibilityDto =
  | { status: "eligible"; evaluatedAt: string }
  | { status: "blocked"; evaluatedAt: string; reasonCode:
      "consent_required" | "consent_not_yet_valid" | "consent_expired" |
      "consent_revoked" | "lead_inactive" };

export type EnterpriseLeadDirectorySuppressionDto =
  | { status: "clear" }
  | { status: "suppressed"; scope: "tenant" | "global"; createdAt: string };

export interface EnterpriseLeadDirectoryOutcomeDto {
  id: string;
  campaignId: string;
  disposition: EnterpriseMarketingDisposition;
  intentLevel: EnterpriseMarketingIntentLevel;
  createdAt: string;
}

export interface EnterpriseLeadDirectoryCrmStatusDto {
  provider: EnterpriseMarketingCrmProvider;
  status: EnterpriseMarketingCrmSyncStatus;
  updatedAt: string;
}

export interface EnterpriseLeadDirectoryItemDto {
  id: string;
  phoneHint?: string;
  externalIdHint?: string;
  countryCode: string;
  language?: string;
  status: "active" | "inactive";
  campaignCount: number;
  consentEligibility: EnterpriseLeadDirectoryConsentEligibilityDto;
  suppression: EnterpriseLeadDirectorySuppressionDto;
  latestVerifiedOutcome?: EnterpriseLeadDirectoryOutcomeDto;
  crmStatus?: EnterpriseLeadDirectoryCrmStatusDto;
  updatedAt: string;
}

export interface EnterpriseLeadDirectoryResponse {
  leads: EnterpriseLeadDirectoryItemDto[];
  nextCursor?: string;
}

export interface EnterpriseLeadDirectoryDetailResponse {
  lead: EnterpriseLeadDirectoryItemDto;
}

export interface EnterpriseCustomerDirectorySessionDto {
  id: string;
  status: "created" | "waiting" | "ai_active" | "handoff_requested" |
    "human_active" | "ended" | "failed";
  channelType: "pstn" | "web" | "app";
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt: string;
}

export interface EnterpriseCustomerDirectoryCaseDto {
  id: string;
  status: "open" | "pending" | "resolved" | "closed";
  createdAt: string;
  resolvedAt?: string;
  closedAt?: string;
  updatedAt: string;
}

export interface EnterpriseCustomerDirectoryItemDto {
  id: string;
  externalIdHint?: string;
  displayName?: string;
  locale?: string;
  consentScopes: string[];
  sessionCount: number;
  openCaseCount: number;
  lastSession?: EnterpriseCustomerDirectorySessionDto;
  updatedAt: string;
}

export interface EnterpriseCustomerDirectoryResponse {
  customers: EnterpriseCustomerDirectoryItemDto[];
  nextCursor?: string;
}

export interface EnterpriseCustomerDirectoryDetailResponse {
  customer: EnterpriseCustomerDirectoryItemDto;
  recentSessions: EnterpriseCustomerDirectorySessionDto[];
  recentCases: EnterpriseCustomerDirectoryCaseDto[];
}
