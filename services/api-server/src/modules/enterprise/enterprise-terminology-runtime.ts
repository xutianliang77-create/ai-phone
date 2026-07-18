import type {
  EnterpriseRuntimeTerminologyContextDto,
  EnterpriseScriptTemplateDto,
  EnterpriseScriptTemplateVersionDto,
  EnterpriseTermEntryDto,
  EnterpriseTerminologyPurpose,
  EnterpriseTermPackDto,
  EnterpriseTermPackVersionDto,
} from "@translation/contracts";
import type { EnterpriseScriptTemplateContent } from "./enterprise-script-template.js";
import type {
  EnterpriseTermPackVersionDimensions,
  PublishEnterpriseVersionInput,
  ResolveEnterpriseTerminologyInput,
} from "./enterprise-terminology.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };
type VersionConflict = { status: "not_found" | "state_conflict" | "version_conflict" };

export interface EnterpriseTerminologyRepositoryRuntime {
  createTermPack?(input: {
    context: EnterpriseTenantContext;
    termPack: { id: string; name: string; createdAt: string };
  }): Promise<
    | { status: "created"; termPack: EnterpriseTermPackDto }
    | { status: "name_conflict" }
    | StorageRequired
  >;
  listTermPacks?(input: { context: EnterpriseTenantContext }): Promise<
    { status: "ready"; termPacks: EnterpriseTermPackDto[] } | StorageRequired
  >;
  createTermPackVersion?(input: {
    context: EnterpriseTenantContext;
    termPackVersion: {
      id: string; termPackId: string; dimensions: EnterpriseTermPackVersionDimensions;
      createdAt: string;
    };
  }): Promise<
    | { status: "created"; termPackVersion: EnterpriseTermPackVersionDto }
    | { status: "pack_not_found" }
    | StorageRequired
  >;
  listTermPackVersions?(input: {
    context: EnterpriseTenantContext; termPackId: string;
  }): Promise<
    { status: "ready"; termPackVersions: EnterpriseTermPackVersionDto[] } | StorageRequired
  >;
  stageTermPackVersion?(input: {
    context: EnterpriseTenantContext;
    content: {
      versionId: string; expectedVersion: number; terms: EnterpriseTermEntryDto[];
      reviewedAt: string;
    };
  }): Promise<
    | { status: "staged"; termPackVersion: EnterpriseTermPackVersionDto }
    | VersionConflict
    | StorageRequired
  >;
  publishTermPackVersion?(input: {
    context: EnterpriseTenantContext; publication: PublishEnterpriseVersionInput;
  }): Promise<
    | { status: "published"; termPackVersion: EnterpriseTermPackVersionDto }
    | VersionConflict
    | StorageRequired
  >;
  createScriptTemplate?(input: {
    context: EnterpriseTenantContext;
    scriptTemplate: {
      id: string; name: string; purpose: EnterpriseTerminologyPurpose; createdAt: string;
    };
  }): Promise<
    | { status: "created"; scriptTemplate: EnterpriseScriptTemplateDto }
    | { status: "name_conflict" }
    | StorageRequired
  >;
  listScriptTemplates?(input: { context: EnterpriseTenantContext }): Promise<
    { status: "ready"; scriptTemplates: EnterpriseScriptTemplateDto[] } | StorageRequired
  >;
  createScriptTemplateVersion?(input: {
    context: EnterpriseTenantContext;
    scriptTemplateVersion: {
      id: string; scriptTemplateId: string; locale: string;
      countryCode: string; productCode: string; createdAt: string;
    };
  }): Promise<
    | { status: "created"; scriptTemplateVersion: EnterpriseScriptTemplateVersionDto }
    | { status: "template_not_found" }
    | StorageRequired
  >;
  listScriptTemplateVersions?(input: {
    context: EnterpriseTenantContext; scriptTemplateId: string;
  }): Promise<
    { status: "ready"; scriptTemplateVersions: EnterpriseScriptTemplateVersionDto[] }
    | StorageRequired
  >;
  stageScriptTemplateVersion?(input: {
    context: EnterpriseTenantContext;
    content: {
      versionId: string; expectedVersion: number;
      content: EnterpriseScriptTemplateContent; reviewedAt: string;
    };
  }): Promise<
    | { status: "staged"; scriptTemplateVersion: EnterpriseScriptTemplateVersionDto }
    | VersionConflict
    | StorageRequired
  >;
  publishScriptTemplateVersion?(input: {
    context: EnterpriseTenantContext; publication: PublishEnterpriseVersionInput;
  }): Promise<
    | { status: "published"; scriptTemplateVersion: EnterpriseScriptTemplateVersionDto }
    | VersionConflict
    | StorageRequired
  >;
  resolveTerminologyContext?(input: {
    context: EnterpriseTenantContext; resolution: ResolveEnterpriseTerminologyInput;
  }): Promise<
    | { status: "ready"; runtimeContext: EnterpriseRuntimeTerminologyContextDto }
    | { status: "term_pack_not_ready" | "script_template_not_ready" }
    | StorageRequired
  >;
}
