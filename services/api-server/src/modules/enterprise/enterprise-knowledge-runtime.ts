import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type {
  CreateEnterpriseKnowledgeSourceInput,
  CreateEnterpriseKnowledgeSourceResult,
  CreateEnterpriseKnowledgeVersionInput,
  CreateEnterpriseKnowledgeVersionResult,
  EnterpriseKnowledgeSearchResult,
  EnterpriseKnowledgeSourceRecord,
  EnterpriseKnowledgeVersionRecord,
  PublishEnterpriseKnowledgeVersionInput,
  PublishEnterpriseKnowledgeVersionResult,
  SearchEnterpriseKnowledgeInput,
  StageEnterpriseKnowledgeChunksInput,
  StageEnterpriseKnowledgeChunksResult,
} from "./enterprise-knowledge.js";

export interface EnterpriseKnowledgeRepositoryRuntime {
  createKnowledgeSource?(input: {
    context: EnterpriseTenantContext;
    source: CreateEnterpriseKnowledgeSourceInput;
  }): Promise<CreateEnterpriseKnowledgeSourceResult | { status: "storage_required" }>;
  listKnowledgeSources?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; sources: EnterpriseKnowledgeSourceRecord[] }
    | { status: "storage_required" }
  >;
  createKnowledgeVersion?(input: {
    context: EnterpriseTenantContext;
    knowledgeVersion: CreateEnterpriseKnowledgeVersionInput;
  }): Promise<CreateEnterpriseKnowledgeVersionResult | { status: "storage_required" }>;
  listKnowledgeVersions?(input: {
    context: EnterpriseTenantContext;
    sourceId: string;
  }): Promise<
    | { status: "ready"; knowledgeVersions: EnterpriseKnowledgeVersionRecord[] }
    | { status: "storage_required" }
  >;
  stageKnowledgeChunks?(input: {
    context: EnterpriseTenantContext;
    chunks: StageEnterpriseKnowledgeChunksInput;
  }): Promise<StageEnterpriseKnowledgeChunksResult | { status: "storage_required" }>;
  publishKnowledgeVersion?(input: {
    context: EnterpriseTenantContext;
    publication: PublishEnterpriseKnowledgeVersionInput;
  }): Promise<PublishEnterpriseKnowledgeVersionResult | { status: "storage_required" }>;
  searchKnowledge?(input: {
    context: EnterpriseTenantContext;
    search: SearchEnterpriseKnowledgeInput;
  }): Promise<
    | { status: "ready"; results: EnterpriseKnowledgeSearchResult[] }
    | { status: "storage_required" }
  >;
}
