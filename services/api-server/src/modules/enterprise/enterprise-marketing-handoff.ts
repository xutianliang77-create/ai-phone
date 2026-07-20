import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingHandoffEvidenceDto,
  EnterpriseMarketingHandoffPolicyDto,
  EnterpriseMarketingHandoffTimeoutAction,
} from "@translation/contracts";

export interface EnterpriseMarketingHandoffPolicyRecord
  extends EnterpriseMarketingHandoffPolicyDto {
  tenantId: string;
  createdBy: string;
  creationKey: string;
  creationRequestHash: string;
  lastCommandKey: string;
  lastCommandHash: string;
}

export interface EnterpriseMarketingHandoffRecord {
  id: string;
  tenantId: string;
  marketingAgentRunId: string;
  dispatchId: string;
  campaignId: string;
  leadId: string;
  communicationSessionId: string;
  supportSessionId: string;
  supportQueueId: string;
  supportChannelId: string;
  policyId: string;
  policyVersion: number;
  timeoutAction: EnterpriseMarketingHandoffTimeoutAction;
  callbackDelaySeconds?: number;
  status: EnterpriseMarketingHandoffEvidenceDto["status"];
  aiFencedAt: string;
  timeoutAt: string;
  mediaRequestedAt?: string;
  mediaAiAudioStoppedAt?: string;
  mediaCompletedAt?: string;
  providerFingerprint?: string;
  providerReceiptHash?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function enterpriseMarketingHandoffHash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function enterpriseMarketingHandoffPolicyDto(
  value: EnterpriseMarketingHandoffPolicyRecord,
): EnterpriseMarketingHandoffPolicyDto {
  const { tenantId: _tenantId, createdBy: _createdBy,
    creationKey: _creationKey, creationRequestHash: _creationRequestHash,
    lastCommandKey: _lastCommandKey, lastCommandHash: _lastCommandHash,
    ...dto } = value;
  return dto;
}

export function enterpriseMarketingHandoffEvidenceDto(
  value: EnterpriseMarketingHandoffRecord,
): EnterpriseMarketingHandoffEvidenceDto {
  const media = value.status === "active" ? "active" :
    value.status === "completed" ? "completed" :
    value.status === "media_not_ready" ? "not_ready" :
    ["failed", "timed_out", "callback_required"].includes(value.status)
      ? "failed" : "pending";
  return {
    id: value.id, communicationSessionId: value.communicationSessionId,
    supportSessionId: value.supportSessionId,
    supportQueueId: value.supportQueueId, status: value.status,
    timeoutAction: value.timeoutAction,
    aiFence: { status: "stopped", verifiedAt: value.aiFencedAt, deadlineMs: 300 },
    media: { status: media,
      ...(value.providerFingerprint
        ? { providerFingerprint: value.providerFingerprint } : {}),
      ...(value.mediaRequestedAt ? { requestedAt: value.mediaRequestedAt } : {}),
      ...(value.mediaAiAudioStoppedAt
        ? { aiAudioStoppedAt: value.mediaAiAudioStoppedAt } : {}),
      ...(value.mediaCompletedAt
        ? { operatorJoinedAt: value.mediaCompletedAt } : {}),
      ...(value.mediaCompletedAt ? { completedAt: value.mediaCompletedAt } : {}),
      ...(value.providerReceiptHash ? { receiptHash: value.providerReceiptHash } : {}),
      ...(value.failureCode ? { reasonCode: value.failureCode } : {}) },
    timeoutAt: value.timeoutAt, createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
