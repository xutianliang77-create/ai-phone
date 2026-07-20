import type {
  EnterpriseMarketingDisposition,
  EnterpriseMarketingIntentLevel,
  EnterpriseMarketingNextActionKind,
  EnterpriseMarketingOutcomeEvidenceRef,
  EnterpriseMarketingOutcomeListResponse,
  EnterpriseMarketingOutcomeDto,
} from "@translation/contracts";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingOutcomeRepositoryRuntime {
  listMarketingOutcomes?(input: { context: EnterpriseTenantContext;
    campaignId: string; now: Date }): Promise<
      { status: "ready"; result: EnterpriseMarketingOutcomeListResponse } |
      { status: "not_found" } | StorageRequired>;
  createMarketingOutcome?(input: { context: EnterpriseTenantContext;
    campaignId: string; outcomeId: string; nextActionId: string; dispatchId: string;
    disposition: EnterpriseMarketingDisposition;
    intentLevel: EnterpriseMarketingIntentLevel; summary: string;
    evidence: EnterpriseMarketingOutcomeEvidenceRef[];
    nextAction?: { kind: EnterpriseMarketingNextActionKind; dueAt?: string };
    idempotencyKey: string; requestHash: string; occurredAt: string }): Promise<
      { status: "created" | "replayed"; outcome: EnterpriseMarketingOutcomeDto } |
      { status: "not_found" | "not_ready" | "evidence_invalid" |
        "already_finalized" | "idempotency_conflict"; reasonCode?: string } |
      StorageRequired>;
}
