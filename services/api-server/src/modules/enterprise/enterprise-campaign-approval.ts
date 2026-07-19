import { createHash } from "node:crypto";
import type {
  EnterpriseCampaignApprovalDecisionDto,
  EnterpriseCampaignApprovalPolicyRef,
  EnterpriseCampaignValidationIssue,
  EnterpriseCampaignValidationSnapshotDto,
} from "@translation/contracts";

export interface EnterpriseCampaignLeadSnapshotItem {
  leadId: string; leadVersion: number; linkId: string; linkVersion: number;
  batchId: string; batchVersion: number; countryCode: string;
  timezone: string | null; language: string | null;
}
export interface EnterpriseCampaignConsentSnapshotItem {
  leadId: string; consentId: string; consentVersion: number;
  evidenceSha256: string; grantedAt: string; expiresAt: string | null;
  policyVersion: string;
}
export interface EnterpriseCampaignSuppressionSnapshotItem {
  leadId: string; suppressionId: string; scope: "tenant" | "global";
  createdAt: string;
}
export interface EnterpriseCampaignValidationSnapshotRecord {
  id: string; tenantId: string; campaignId: string; sourceCampaignVersion: number;
  status: "ready" | "blocked"; targetAt?: string;
  campaignSnapshot: Record<string, unknown>; campaignHash: string;
  policies: EnterpriseCampaignApprovalPolicyRef[]; policySetHash: string;
  leads: EnterpriseCampaignLeadSnapshotItem[]; leadSetHash: string;
  consents: EnterpriseCampaignConsentSnapshotItem[]; consentSetHash: string;
  suppressions: EnterpriseCampaignSuppressionSnapshotItem[];
  suppressionSetHash: string; issues: EnterpriseCampaignValidationIssue[];
  snapshotHash: string; validatedBy: string; validatedAt: string;
  creationKey: string; creationRequestHash: string; version: number;
}
export interface EnterpriseCampaignApprovalDecisionRecord {
  id: string; tenantId: string; campaignId: string; validationSnapshotId: string;
  decision: "approved" | "rejected"; rejectionReason?: string;
  decisionHash: string; decidedBy: string; decidedAt: string;
  creationKey: string; creationRequestHash: string; version: number;
}

export function campaignApprovalCommandHash(input: {
  actorUserId: string; campaignId: string;
  command: "validate" | "approve" | "reject"; expectedVersion: number;
  validationSnapshotId?: string; reason?: string;
}) { return digest(input); }

export function campaignValidationSnapshotDto(
  value: EnterpriseCampaignValidationSnapshotRecord,
): EnterpriseCampaignValidationSnapshotDto {
  return { id: value.id, campaignId: value.campaignId,
    sourceCampaignVersion: value.sourceCampaignVersion, status: value.status,
    ...(value.targetAt ? { targetAt: value.targetAt } : {}),
    campaignHash: value.campaignHash, policies: value.policies,
    policySetHash: value.policySetHash,
    dataSnapshot: { leadCount: value.leads.length, leadSetHash: value.leadSetHash,
      consentCount: value.consents.length, consentSetHash: value.consentSetHash,
      suppressionCount: value.suppressions.length,
      suppressionSetHash: value.suppressionSetHash },
    issues: value.issues, snapshotHash: value.snapshotHash,
    validatedBy: value.validatedBy, validatedAt: value.validatedAt,
    version: value.version };
}
export function campaignApprovalDecisionDto(
  value: EnterpriseCampaignApprovalDecisionRecord,
): EnterpriseCampaignApprovalDecisionDto {
  return { id: value.id, campaignId: value.campaignId,
    validationSnapshotId: value.validationSnapshotId, decision: value.decision,
    ...(value.rejectionReason ? { rejectionReason: value.rejectionReason } : {}),
    decisionHash: value.decisionHash, decidedBy: value.decidedBy,
    decidedAt: value.decidedAt, version: value.version };
}
export function campaignApprovalDecisionHash(input: {
  campaignId: string; validationSnapshotId: string;
  decision: "approved" | "rejected"; rejectionReason?: string;
  decidedBy: string; decidedAt: string;
}) { return digest(input); }

export function stableCampaignApprovalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCampaignApprovalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as
    Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableCampaignApprovalJson(item)}`)
    .join(",")}}`;
  return JSON.stringify(value);
}
export function digest(value: unknown) { return createHash("sha256")
  .update(stableCampaignApprovalJson(value)).digest("hex"); }
