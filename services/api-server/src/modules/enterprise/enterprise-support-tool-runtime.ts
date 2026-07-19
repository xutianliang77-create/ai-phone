import type {
  EnterpriseSupportReadToolExecutionResponse,
  EnterpriseSupportToolAuthorizationResponse,
  EnterpriseSupportToolDefinitionDto,
} from "@translation/contracts";
import type { PreparedEnterpriseSupportToolDefinition } from
  "./enterprise-support-tool-registry.js";
import type { EnterpriseTenantContext } from "./enterprise-tenant-context.js";

type StorageRequired = { status: "storage_required" };
type WorkerInput = {
  ticket: string;
  workerCellId: string;
  workerId: string;
  traceId: string;
  now?: Date;
};

export interface EnterpriseSupportToolRepositoryRuntime {
  createSupportToolDefinition?(input: {
    context: EnterpriseTenantContext;
    id: string;
    definition: PreparedEnterpriseSupportToolDefinition;
    createdAt: string;
  }): Promise<
    | { status: "created"; definition: EnterpriseSupportToolDefinitionDto }
    | StorageRequired
  >;
  listSupportToolDefinitions?(input: {
    context: EnterpriseTenantContext;
  }): Promise<
    | { status: "ready"; definitions: EnterpriseSupportToolDefinitionDto[] }
    | StorageRequired
  >;
  publishSupportToolDefinition?(input: {
    context: EnterpriseTenantContext;
    definitionId: string;
    expectedVersion: number;
    publishedAt: string;
  }): Promise<
    | { status: "published"; definition: EnterpriseSupportToolDefinitionDto }
    | { status: "not_found" | "conflict" }
    | StorageRequired
  >;
  retireSupportToolDefinition?(input: {
    context: EnterpriseTenantContext;
    definitionId: string;
    expectedVersion: number;
    retiredAt: string;
  }): Promise<
    | { status: "retired"; definition: EnterpriseSupportToolDefinitionDto }
    | { status: "not_found" | "conflict" }
    | StorageRequired
  >;
  authorizeSupportToolRequest?(input: WorkerInput & {
    runId: string;
    toolName: string;
    idempotencyKey: string;
    arguments: Record<string, unknown>;
  }): Promise<
    | EnterpriseSupportToolAuthorizationResponse
    | { status: "not_registered" | "invalid_arguments" |
        "idempotency_conflict" | "run_mismatch" }
    | { status: string }
  >;
  executeSupportReadTool?(input: WorkerInput & {
    runId: string;
    executionId: string;
    arguments: Record<string, unknown>;
  }): Promise<
    | EnterpriseSupportReadToolExecutionResponse
    | { status: "in_progress" | "not_configured" | "failed" |
        "not_found" | "invalid_arguments" | "unsupported_tool" |
        "definition_not_active" | "execution_mismatch" |
        "run_mismatch" | "lease_expired" | "conflict";
        reasonCode?: string }
    | { status: string }
  >;
}
