import { createHash, randomBytes } from "node:crypto";
import type { EnterpriseMarketingSchedulerClaimedTaskDto,
  EnterpriseMarketingTaskCounts, EnterpriseMarketingTaskStatus } from
  "@translation/contracts";

export interface EnterpriseMarketingTaskRecord {
  id: string; tenantId: string; campaignId: string; leadId: string;
  scheduledAt: string; status: EnterpriseMarketingTaskStatus; attempt: number;
  idempotencyKey: string; outcomeCode?: string; claimedAt?: string;
  approvalSnapshotId: string; countryPolicyVersionId: string;
  generationHash: string; generatedBy: string; generatedAt: string;
  usageHoldId?: string; claimOwner?: string; claimTokenHash?: string;
  leaseExpiresAt?: string; dispatchGeneration: number;
  createdAt: string; updatedAt: string; version: number;
}

export interface EnterpriseMarketingPreparedTask {
  id: string; campaignId: string; leadId: string; scheduledAt: string;
  approvalSnapshotId: string; countryPolicyVersionId: string;
  idempotencyKey: string; generationHash: string;
}

export interface EnterpriseMarketingSchedulerStatusRecord {
  counts: EnterpriseMarketingTaskCounts; nextDueAt?: string; activeClaims: number;
  tenantActiveClaims: number;
}

export interface EnterpriseMarketingClaimedTask extends EnterpriseMarketingTaskRecord {
  usageHoldId: string; claimOwner: string; claimTokenHash: string;
  leaseExpiresAt: string; claimToken: string;
}

export function marketingTaskIdentity(input: { tenantId: string; campaignId: string;
  approvalSnapshotId: string; leadId: string; attempt: number }) {
  const source = JSON.stringify([input.tenantId, input.campaignId,
    input.approvalSnapshotId, input.leadId, input.attempt]);
  const bytes = Buffer.from(createHash("sha256").update(source).digest("hex").slice(0, 32),
    "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function marketingTaskGenerationHash(input: { campaignId: string; leadId: string;
  scheduledAt: string; approvalSnapshotId: string; countryPolicyVersionId: string;
  attempt: number }) { return digest(input); }

export function issueMarketingSchedulerClaimToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: digest(token) };
}

export function marketingSchedulerHoldHash(input: { taskId: string; generation: number;
  amount: number; leaseExpiresAt: string }) { return digest(input); }

export function marketingSchedulerClaimedTaskDto(
  task: EnterpriseMarketingClaimedTask,
): EnterpriseMarketingSchedulerClaimedTaskDto {
  return { id: task.id, campaignId: task.campaignId, leadId: task.leadId,
    scheduledAt: task.scheduledAt, attempt: task.attempt,
    approvalSnapshotId: task.approvalSnapshotId,
    countryPolicyVersionId: task.countryPolicyVersionId,
    usageHoldId: task.usageHoldId, claimToken: task.claimToken,
    leaseExpiresAt: task.leaseExpiresAt,
    dispatchGeneration: task.dispatchGeneration, version: task.version };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as
    Record<string, unknown>).filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) { return createHash("sha256").update(stable(value))
  .digest("hex"); }
