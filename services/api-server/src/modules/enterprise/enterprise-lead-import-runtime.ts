import type {
  EnterpriseCampaignLeadDto,
  EnterpriseLeadImportBatchDto,
  EnterpriseLeadImportErrorDto,
  EnterpriseLeadImportRowReportDto,
  EnterpriseLeadImportSourceKind,
} from "@translation/contracts";
import type { NormalizedEnterpriseLeadImportRow } from
  "./enterprise-lead-import.js";
import type { EnterpriseLeadPhoneKeyring } from "./enterprise-lead-phone.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };
type ProtectionRequired = { status: "protection_required" };

export interface ImportEnterpriseLeadsInput {
  context: EnterpriseTenantContext;
  campaignId: string;
  sourceKind: EnterpriseLeadImportSourceKind;
  sourceReference: string;
  rows: NormalizedEnterpriseLeadImportRow[];
  idempotencyKey: string;
  requestHash: string;
  occurredAt: string;
  keyring: EnterpriseLeadPhoneKeyring;
}

export type ImportEnterpriseLeadsResult =
  | { status: "committed" | "replayed"; batch: EnterpriseLeadImportBatchDto;
      rows: EnterpriseLeadImportRowReportDto[] }
  | { status: "rejected"; totalRows: number; errors: EnterpriseLeadImportErrorDto[] }
  | { status: "not_found" | "campaign_not_editable" | "idempotency_conflict" }
  | StorageRequired
  | ProtectionRequired;

export interface EnterpriseLeadImportRepositoryRuntime {
  importCampaignLeads?(input: Omit<ImportEnterpriseLeadsInput, "keyring">):
    Promise<ImportEnterpriseLeadsResult>;
  listCampaignLeads?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
  }): Promise<
    | { status: "ready"; leads: EnterpriseCampaignLeadDto[] }
    | { status: "not_found" }
    | StorageRequired
  >;
  listLeadImportBatches?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
  }): Promise<
    | { status: "ready"; batches: EnterpriseLeadImportBatchDto[] }
    | { status: "not_found" }
    | StorageRequired
  >;
  rollbackLeadImportBatch?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    batchId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    occurredAt: string;
  }): Promise<
    | { status: "rolled_back" | "replayed"; batch: EnterpriseLeadImportBatchDto }
    | { status: "not_found" | "conflict" | "campaign_not_editable" |
        "idempotency_conflict" }
    | StorageRequired
  >;
}
