import { createHash } from "node:crypto";
import type {
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
  EnterpriseMarketingNextActionKind,
  EnterpriseMarketingOutcomeDto,
  EnterpriseMarketingOutcomeEvidenceDto,
} from "@translation/contracts";

export interface EnterpriseMarketingOutcomeRecord
  extends Omit<EnterpriseMarketingOutcomeDto, "lead" | "nextAction"> {
  tenantId: string;
  leadId: string;
  phoneHint: string;
  createdBy: string;
  idempotencyKey: string;
  requestHash: string;
  nextAction?: EnterpriseMarketingNextActionRecord;
}

export interface EnterpriseMarketingNextActionRecord {
  id: string;
  tenantId: string;
  outcomeId: string;
  taskId: string;
  campaignId: string;
  leadId: string;
  kind: EnterpriseMarketingNextActionKind;
  status: "requested";
  dueAt?: string;
  evidenceHash: string;
  createdBy: string;
  idempotencyKey: string;
  requestHash: string;
  createdAt: string;
}

export const enterpriseMarketingDispositions: EnterpriseMarketingDisposition[] = [
  "no_interest", "potential_lead", "appointment_requested",
  "follow_up_required", "do_not_contact", "invalid_number", "call_failed",
  "completed_unclassified",
];
export const enterpriseMarketingIntentLevels: EnterpriseMarketingIntentLevel[] = [
  "none", "low", "medium", "high", "unknown",
];
export const enterpriseMarketingNextActionKinds: EnterpriseMarketingNextActionKind[] = [
  "callback", "appointment_request", "send_material", "manual_review",
];

export function enterpriseMarketingOutcomeHash(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function enterpriseMarketingOutcomeDto(
  value: EnterpriseMarketingOutcomeRecord,
): EnterpriseMarketingOutcomeDto {
  return {
    id: value.id, campaignId: value.campaignId, taskId: value.taskId,
    dispatchId: value.dispatchId,
    communicationSessionId: value.communicationSessionId,
    lead: { id: value.leadId, phoneHint: value.phoneHint },
    ...(value.agentRunId ? { agentRunId: value.agentRunId } : {}),
    disposition: value.disposition, intentLevel: value.intentLevel,
    summary: value.summary, evidence: value.evidence,
    evidenceHash: value.evidenceHash, sourceHash: value.sourceHash,
    ...(value.nextAction ? { nextAction: {
      id: value.nextAction.id, kind: value.nextAction.kind,
      status: value.nextAction.status,
      ...(value.nextAction.dueAt ? { dueAt: value.nextAction.dueAt } : {}),
      evidenceHash: value.nextAction.evidenceHash,
      createdAt: value.nextAction.createdAt,
    } } : {}),
    createdAt: value.createdAt, version: value.version,
  };
}

export function validEnterpriseMarketingOutcomeCombination(input: {
  disposition: EnterpriseMarketingDisposition;
  intentLevel: EnterpriseMarketingIntentLevel;
  nextAction?: { kind: EnterpriseMarketingNextActionKind; dueAt?: string };
}) {
  const next = input.nextAction?.kind;
  if (["do_not_contact", "no_interest", "invalid_number"].includes(
    input.disposition) && next) return false;
  if (input.disposition === "appointment_requested" &&
    next !== "appointment_request") return false;
  if (input.disposition === "follow_up_required" && !next) return false;
  if (input.disposition === "call_failed" && next && next !== "manual_review") {
    return false;
  }
  if (["no_interest", "do_not_contact", "invalid_number", "call_failed"].includes(
    input.disposition) && !["none", "unknown"].includes(input.intentLevel)) {
    return false;
  }
  if (input.disposition === "potential_lead" &&
    !["low", "medium", "high"].includes(input.intentLevel)) return false;
  if (input.disposition === "appointment_requested" &&
    !["medium", "high"].includes(input.intentLevel)) return false;
  if (next && ["callback", "appointment_request"].includes(next) &&
    !input.nextAction?.dueAt) return false;
  return true;
}

export function validEvidence(value: unknown): value is EnterpriseMarketingOutcomeEvidenceDto[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 &&
    value.every((item) => item && typeof item === "object" &&
      typeof (item as { type?: unknown }).type === "string" &&
      typeof (item as { id?: unknown }).id === "string" &&
      /^[a-f0-9]{64}$/.test(String((item as { contentHash?: unknown }).contentHash)));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
