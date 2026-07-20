import type {
  EnterpriseKnowledgeSearchResultDto,
  EnterpriseMarketingAgentProfileDto,
  EnterpriseMarketingAgentTurnOutput,
  UpsertEnterpriseMarketingAgentProfileRequest,
} from "@translation/contracts";
import type { EnterpriseMarketingAgentTicketPayload } from
  "./enterprise-marketing-agent-ticket.js";
import type { EnterpriseMarketingAgentResolvedContent,
  EnterpriseMarketingAgentRunRecord, EnterpriseMarketingAgentTurnRecord } from
  "./enterprise-marketing-agent.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseMarketingAgentRepositoryRuntime {
  listMarketingAgentProfiles?(input: { context: EnterpriseTenantContext;
    campaignId: string }): Promise<{ status: "ready";
      profiles: EnterpriseMarketingAgentProfileDto[] } |
      { status: "not_found" } | StorageRequired>;
  upsertMarketingAgentProfile?(input: { context: EnterpriseTenantContext;
    campaignId: string; profileId: string; idempotencyKey: string;
    requestHash: string; occurredAt: string;
    expectedVersion?: number;
    profile: Omit<UpsertEnterpriseMarketingAgentProfileRequest,
      "tenantId" | "expectedVersion"> }): Promise<
      { status: "created" | "updated" | "replayed";
        profile: EnterpriseMarketingAgentProfileDto } |
      { status: "not_found" | "not_editable" | "version_conflict" |
        "idempotency_conflict" } | StorageRequired>;
  getMarketingAgentSnapshot?(input: { ticket: EnterpriseMarketingAgentTicketPayload;
    traceId: string }): Promise<{ status: "ready";
      run: EnterpriseMarketingAgentRunRecord; profile: EnterpriseMarketingAgentProfileDto } |
      { status: "not_ready" } | StorageRequired>;
  authorizeMarketingAgentDisclosure?(input: {
    ticket: EnterpriseMarketingAgentTicketPayload; traceId: string; now: string;
  }): Promise<{ status: "authorized"; run: EnterpriseMarketingAgentRunRecord } |
    { status: "conflict" } | StorageRequired>;
  deliverMarketingAgentDisclosure?(input: {
    ticket: EnterpriseMarketingAgentTicketPayload; traceId: string; now: string;
  }): Promise<{ status: "delivered"; run: EnterpriseMarketingAgentRunRecord } |
    { status: "conflict" } | StorageRequired>;
  prepareMarketingAgentTurn?(input: {
    ticket: EnterpriseMarketingAgentTicketPayload; traceId: string;
    inputTurnId: string; idempotencyKey: string; customerText: string;
    detectedLocale: string; now: string;
  }): Promise<{ status: "ready"; run: EnterpriseMarketingAgentRunRecord;
    turn: EnterpriseMarketingAgentTurnRecord;
    content: EnterpriseMarketingAgentResolvedContent;
    evidence: EnterpriseKnowledgeSearchResultDto[];
    directive: "generate" | "opt_out" | "handoff" | "handoff_unavailable";
    context: EnterpriseMarketingAgentRunRecord["contextDocument"];
    replayed: boolean } | { status: "not_ready" | "idempotency_conflict" } |
    StorageRequired>;
  completeMarketingAgentTurn?(input: {
    ticket: EnterpriseMarketingAgentTicketPayload; traceId: string;
    runId: string; turnId: string; customerText: string;
    locale: string; evidenceHash: string;
    output: EnterpriseMarketingAgentTurnOutput;
    status: "generated" | "degraded" | "handoff" | "ended";
    context: EnterpriseMarketingAgentRunRecord["contextDocument"];
    optOut: boolean; providerFingerprint?: string; failureCode?: string; now: string;
  }): Promise<{ status: "updated"; run: EnterpriseMarketingAgentRunRecord;
    turn: EnterpriseMarketingAgentTurnRecord } | { status: "conflict" } |
    StorageRequired>;
  authorizeMarketingAgentTts?(input: { ticket: EnterpriseMarketingAgentTicketPayload;
    traceId: string; turnId: string; now: string }): Promise<
      { status: "authorized"; run: EnterpriseMarketingAgentRunRecord;
        turn: EnterpriseMarketingAgentTurnRecord } |
      { status: "conflict" } | StorageRequired>;
  deliverMarketingAgentTurn?(input: { ticket: EnterpriseMarketingAgentTicketPayload;
    traceId: string; turnId: string; now: string }): Promise<
      { status: "delivered"; run: EnterpriseMarketingAgentRunRecord;
        turn: EnterpriseMarketingAgentTurnRecord;
        handoff?: { status: "queued" | "replayed" | "not_configured" | "not_ready";
          supportSessionId?: string; reasonCode?: string } } |
      { status: "conflict" } | StorageRequired>;
  finalizeMarketingAgent?(input: { ticket: EnterpriseMarketingAgentTicketPayload;
    traceId: string; outcome: "completed" | "failed"; now: string }): Promise<
      { status: "completed" | "failed"; run: EnterpriseMarketingAgentRunRecord } |
      { status: "conflict" } | StorageRequired>;
}
