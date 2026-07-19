import type {
  AgentConsultDto,
  AgentConsultStatus,
} from "@translation/contracts";
import type { PostgresAggregateFence } from
  "../../infrastructure/storage/postgres-primary-store.js";
import { updateAgentConsultStatus } from "./postgres-agent-consult-uow.js";

export interface AgentConsultUpdateInput {
  consultId: string;
  status: AgentConsultStatus;
  expectedVersion?: number;
  providerOperationId?: string;
  failureCode?: string;
  billableSeconds?: number;
  commandId: string;
  requestHash: string;
  fence: PostgresAggregateFence;
  now?: Date;
}

export interface AgentConsultCompleteInput {
  consultId: string;
  expectedVersion: number;
  runId: string;
  commandId: string;
  requestHash: string;
  fence: PostgresAggregateFence;
  now?: Date;
}

export function applyConsultUpdate(
  current: AgentConsultDto,
  input: AgentConsultUpdateInput,
) {
  const timestamp = (input.now ?? new Date()).toISOString();
  const next = updateAgentConsultStatus(current, input.status, timestamp);
  if (input.providerOperationId) next.providerOperationId = input.providerOperationId;
  if (input.failureCode) next.failureCode = input.failureCode.slice(0, 80);
  if (input.billableSeconds !== undefined) {
    next.billableSeconds = Math.max(0, Math.ceil(input.billableSeconds));
  }
  if (JSON.stringify(current) !== JSON.stringify(next) &&
    next.version === current.version) {
    next.version += 1;
  }
  return next;
}

export function consultUpdateChanges(
  current: AgentConsultDto,
  input: AgentConsultUpdateInput,
) {
  if (current.status !== input.status) return true;
  if (input.providerOperationId &&
    current.providerOperationId !== input.providerOperationId) return true;
  if (input.failureCode &&
    current.failureCode !== input.failureCode.slice(0, 80)) return true;
  return input.billableSeconds !== undefined && current.billableSeconds !==
    Math.max(0, Math.ceil(input.billableSeconds));
}
