import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { EnterpriseCampaignRecord } from "./enterprise-campaign.js";
import type { EnterpriseCampaignApprovalDecisionRecord,
  EnterpriseCampaignValidationSnapshotRecord } from
  "./enterprise-campaign-approval.js";

type StorageRequired = { status: "storage_required" };
type Conflict = { status: "not_found" | "conflict" | "not_validatable" |
  "not_decidable" | "idempotency_conflict" | "validation_stale" };

export interface EnterpriseCampaignApprovalRepositoryRuntime {
  getCampaignApproval?(input: { context: EnterpriseTenantContext;
    campaignId: string }): Promise<{
      status: "ready"; latestValidation?: EnterpriseCampaignValidationSnapshotRecord;
      decisions: EnterpriseCampaignApprovalDecisionRecord[];
    } | { status: "not_found" } | StorageRequired>;
  validateCampaign?(input: { context: EnterpriseTenantContext; campaignId: string;
    expectedVersion: number; validationId: string; idempotencyKey: string;
    requestHash: string; validatedAt: string }): Promise<{
      status: "created" | "replayed";
      validation: EnterpriseCampaignValidationSnapshotRecord;
      campaign?: EnterpriseCampaignRecord;
    } | Conflict | StorageRequired>;
  approveCampaign?(input: { context: EnterpriseTenantContext; campaignId: string;
    expectedVersion: number; validationSnapshotId: string; decisionId: string;
    idempotencyKey: string; requestHash: string; decidedAt: string }): Promise<{
      status: "approved" | "rejected" | "replayed";
      decision: EnterpriseCampaignApprovalDecisionRecord;
      campaign: EnterpriseCampaignRecord;
    } | Conflict | StorageRequired>;
  rejectCampaign?(input: { context: EnterpriseTenantContext; campaignId: string;
    expectedVersion: number; validationSnapshotId: string; reason: string;
    decisionId: string; idempotencyKey: string; requestHash: string;
    decidedAt: string }): Promise<{
      status: "approved" | "rejected" | "replayed";
      decision: EnterpriseCampaignApprovalDecisionRecord;
      campaign: EnterpriseCampaignRecord;
    } | Conflict | StorageRequired>;
}
