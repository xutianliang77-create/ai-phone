export type EnterpriseCountryPolicyLifecycleStatus =
  | "not_yet_effective"
  | "active"
  | "expired";

export type EnterpriseCountryPolicyVoicemailMode =
  | "disabled"
  | "compliant_message"
  | "human_only";

export interface EnterpriseCountryPolicyCallingWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface EnterpriseCountryPolicyDisclosure {
  version: string;
  brand: string;
  aiIdentity: string;
  marketingPurpose: string;
}

export interface EnterpriseCountryPolicyVoicemail {
  mode: EnterpriseCountryPolicyVoicemailMode;
  version?: string;
  message?: string;
}

export interface PublishEnterpriseCountryPolicyRequest {
  tenantId?: string;
  countryCode: string;
  policyVersion: string;
  callingWindows: EnterpriseCountryPolicyCallingWindow[];
  maxAttempts: number;
  frequencyWindowHours: number;
  minRetryIntervalMinutes: number;
  disclosure: EnterpriseCountryPolicyDisclosure;
  voicemail: EnterpriseCountryPolicyVoicemail;
  complianceReference: string;
  effectiveFrom: string;
  expiresAt: string;
}

export interface EnterpriseCountryPolicyDto extends
  Omit<PublishEnterpriseCountryPolicyRequest, "tenantId"> {
  id: string;
  lifecycleStatus: EnterpriseCountryPolicyLifecycleStatus;
  contentHash: string;
  publishedBy: string;
  publishedAt: string;
  version: number;
}

export interface EnterpriseCountryPoliciesResponse {
  evaluatedAt: string;
  policies: EnterpriseCountryPolicyDto[];
}

export interface EnterpriseCountryPolicyResponse {
  policy: EnterpriseCountryPolicyDto;
  replayed?: true;
}

export type EnterpriseCountryPolicyReadinessReason =
  | "country_policy_missing"
  | "country_policy_not_yet_effective"
  | "country_policy_expired";

export interface EnterpriseCountryPolicyReadinessIssue {
  countryCode: string;
  reasonCode: EnterpriseCountryPolicyReadinessReason;
}

export interface EnterpriseCampaignCountryPolicyReadinessResponse {
  status: "ready" | "blocked";
  evaluatedAt: string;
  targetAt: string;
  policies: EnterpriseCountryPolicyDto[];
  issues: EnterpriseCountryPolicyReadinessIssue[];
}
