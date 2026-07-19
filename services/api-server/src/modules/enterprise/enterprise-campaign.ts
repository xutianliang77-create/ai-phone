import { createHash } from "node:crypto";
import type {
  CreateEnterpriseCampaignRequest,
  EnterpriseCampaignApprovalStatus,
  EnterpriseCampaignScheduleDto,
  EnterpriseCampaignStatus,
  UpdateEnterpriseCampaignRequest,
} from "@translation/contracts";

export const enterpriseCampaignStatuses: readonly EnterpriseCampaignStatus[] = [
  "draft", "validating", "pending_approval", "approved", "scheduled",
  "running", "paused", "completed", "cancelled", "failed",
];
export const enterpriseCampaignApprovalStatuses:
  readonly EnterpriseCampaignApprovalStatus[] = [
    "not_submitted", "pending", "approved", "rejected", "expired",
  ];

export interface EnterpriseCampaignRecord {
  id: string;
  tenantId: string;
  name: string;
  objective: string;
  ownerUserId: string;
  countryCodes: string[];
  languageCodes: string[];
  status: EnterpriseCampaignStatus;
  approvalStatus: EnterpriseCampaignApprovalStatus;
  policyVersion?: string;
  schedule: EnterpriseCampaignScheduleDto;
  concurrencyLimit: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateEnterpriseCampaignInput
  extends Omit<CreateEnterpriseCampaignRequest, "tenantId"> {
  id: string;
  ownerUserId: string;
  createdAt: string;
  idempotencyKey: string;
  requestHash: string;
}

export type EnterpriseCampaignScheduleBlock =
  | "approval_required"
  | "policy_version_required"
  | "schedule_start_required"
  | "schedule_start_elapsed"
  | "status_not_schedulable"
  | "country_policy_missing"
  | "country_policy_not_yet_effective"
  | "country_policy_expired";

export function campaignRequestHash(input: {
  ownerUserId: string;
  campaign: Omit<CreateEnterpriseCampaignRequest, "tenantId">;
}) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export function campaignCommandRequestHash(input: {
  actorUserId: string;
  campaignId: string;
  command: "draft_update" | "schedule";
  expectedVersion: number;
  patch?: Omit<UpdateEnterpriseCampaignRequest, "tenantId" | "expectedVersion">;
}) {
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

export function campaignScheduleBlock(
  campaign: EnterpriseCampaignRecord,
  now: string,
): EnterpriseCampaignScheduleBlock | null {
  if (campaign.approvalStatus !== "approved") return "approval_required";
  if (campaign.status !== "approved") return "status_not_schedulable";
  if (!campaign.policyVersion) return "policy_version_required";
  if (!campaign.schedule.startAt) return "schedule_start_required";
  if (campaign.schedule.startAt <= now) return "schedule_start_elapsed";
  return null;
}

export function mergeCampaignDraft(
  current: EnterpriseCampaignRecord,
  patch: Omit<UpdateEnterpriseCampaignRequest, "tenantId" | "expectedVersion">,
) {
  return {
    name: patch.name ?? current.name,
    objective: patch.objective ?? current.objective,
    countryCodes: patch.countryCodes ?? current.countryCodes,
    languageCodes: patch.languageCodes ?? current.languageCodes,
    schedule: patch.schedule ?? current.schedule,
    concurrencyLimit: patch.concurrencyLimit ?? current.concurrencyLimit,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
