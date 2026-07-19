import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  CreateEnterpriseCampaignInput,
  EnterpriseCampaignRecord,
  EnterpriseCampaignScheduleBlock,
} from "./enterprise-campaign.js";
import type { UpdateEnterpriseCampaignRequest } from "@translation/contracts";

type StorageRequired = { status: "storage_required" };

export interface EnterpriseCampaignRepositoryRuntime {
  createCampaign?(input: {
    context: EnterpriseTenantContext;
    campaign: CreateEnterpriseCampaignInput;
  }): Promise<
    | { status: "created" | "replayed"; campaign: EnterpriseCampaignRecord }
    | { status: "idempotency_conflict" }
    | StorageRequired
  >;
  getCampaign?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
  }): Promise<
    | { status: "ready"; campaign: EnterpriseCampaignRecord }
    | { status: "not_found" }
    | StorageRequired
  >;
  listCampaigns?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; campaigns: EnterpriseCampaignRecord[] }
    | StorageRequired
  >;
  updateCampaignDraft?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    expectedVersion: number;
    patch: Omit<UpdateEnterpriseCampaignRequest, "tenantId" | "expectedVersion">;
    idempotencyKey: string;
    requestHash: string;
    updatedAt: string;
  }): Promise<
    | { status: "updated" | "replayed"; campaign: EnterpriseCampaignRecord }
    | { status: "not_found" | "conflict" | "not_editable" | "idempotency_conflict" }
    | StorageRequired
  >;
  scheduleCampaign?(input: {
    context: EnterpriseTenantContext;
    campaignId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    occurredAt: string;
  }): Promise<
    | { status: "scheduled" | "replayed"; campaign: EnterpriseCampaignRecord;
        generatedTaskCount?: number }
    | { status: "not_found" | "conflict" | "idempotency_conflict" }
    | { status: "blocked"; reasonCode: EnterpriseCampaignScheduleBlock;
        replayed?: boolean }
    | StorageRequired
  >;
}
