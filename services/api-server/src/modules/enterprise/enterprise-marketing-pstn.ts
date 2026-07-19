import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingPstnDispatchCounts,
  EnterpriseMarketingPstnDispatchStatus,
} from "@translation/contracts";

export interface EnterpriseMarketingPstnDispatchRecord {
  id: string;
  tenantId: string;
  taskId: string;
  campaignId: string;
  communicationSessionId: string;
  communicationBindingId: string;
  usageHoldId: string;
  outboxEventId: string;
  dispatchGeneration: number;
  routeEpoch: number;
  homeRegion: string;
  cellId: string;
  provider: "pstn_http" | "pstn_fonoster";
  providerFingerprint: string;
  providerIdempotencyKey: string;
  requestHash: string;
  status: EnterpriseMarketingPstnDispatchStatus;
  providerCallId?: string;
  lastProviderEventId?: string;
  failureCode?: string;
  preparedAt: string;
  acceptedAt?: string;
  answeredAt?: string;
  endedAt?: string;
  updatedAt: string;
  version: number;
}

export interface EnterpriseMarketingPstnCallRequest {
  idempotencyKey: string;
  draftId: string;
  callId: string;
  targetName?: string;
  targetPhone: string;
  objective: string;
  suggestedScript: string;
  language: string;
  consentPromptVersion: string;
  enterpriseAgent: {
    runtimeUrl: string;
    ticket: string;
    runId: string;
    disclosureRequired: true;
  };
  enterpriseContext: {
    tenantId: string;
    homeRegion: string;
    cellId: string;
    routeEpoch: number;
    taskId: string;
    dispatchGeneration: number;
  };
}

export function marketingPstnIdentity(input: {
  kind: "dispatch" | "binding" | "session" | "agent_run" | "agent_ticket";
  tenantId: string;
  taskId: string;
  generation: number;
}) {
  const digest = createHash("sha256").update(JSON.stringify([
    input.kind, input.tenantId, input.taskId, input.generation,
  ])).digest("hex");
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function marketingPstnIdempotencyKey(input: {
  tenantId: string;
  taskId: string;
  generation: number;
}) {
  return `marketing:pstn:${input.tenantId}:${input.taskId}:g${input.generation}`;
}

export function marketingPstnRequestHash(input: {
  taskId: string;
  generation: number;
  phoneHash: string;
  objective: string;
  language: string;
  policyVersionId: string;
}) {
  return createHash("sha256").update(stable(input)).digest("hex");
}

export function emptyMarketingPstnDispatchCounts():
  EnterpriseMarketingPstnDispatchCounts {
  return { total: 0, prepared: 0, unknown: 0, accepted: 0,
    answered: 0, completed: 0, failed: 0 };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
