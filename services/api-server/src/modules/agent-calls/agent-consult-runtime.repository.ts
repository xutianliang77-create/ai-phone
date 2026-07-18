import type { AgentConsultDto, AgentConsultStatus } from "@translation/contracts";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import * as legacy from "./agent-consult.repository.js";

export async function beginAgentConsult(input: {
  runId: string;
  sessionId: string;
  mainRoomName: string;
  operatorPhoneHash: string;
  idempotencyKey: string;
  requestHash: string;
  ttlSeconds: number;
  now?: Date;
}): Promise<
  { status: string; consult: AgentConsultDto } | { status: "not_found" }
> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.beginAgentConsult(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: input.sessionId },
    (fence) => runtime.postgres.agentConsults.begin({
      ...input,
      commandId: commandId(input.sessionId,
        `begin:${input.idempotencyKey}`, input.requestHash),
      fence,
    }),
  ) as Promise<
    { status: string; consult: AgentConsultDto } | { status: "not_found" }
  >;
}

export async function updateAgentConsult(input: {
  consultId: string;
  status: AgentConsultStatus;
  expectedVersion?: number;
  providerOperationId?: string;
  failureCode?: string;
  billableSeconds?: number;
  now?: Date;
}): Promise<
  { status: string; consult: AgentConsultDto } | { status: "not_found" }
> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.updateAgentConsult(input);
  const consult = await runtime.postgres.agentConsultQueries.find(input.consultId);
  if (!consult) return { status: "not_found" as const };
  const requestHash = repositoryRequestHash(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: consult.sessionId },
    (fence) => runtime.postgres.agentConsults.update({
      ...input,
      commandId: commandId(consult.sessionId,
        `update:${input.consultId}:${input.status}`, requestHash),
      requestHash,
      fence,
    }),
  ) as Promise<
    { status: string; consult: AgentConsultDto } | { status: "not_found" }
  >;
}

export async function completeAgentConsultHandoff(input: {
  consultId: string;
  expectedVersion: number;
  runId: string;
  now?: Date;
}): Promise<
  { status: string; consult: AgentConsultDto } | { status: "not_found" }
> {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.completeAgentConsultHandoff(input);
  const consult = await runtime.postgres.agentConsultQueries.find(input.consultId);
  if (!consult) return { status: "not_found" as const };
  const requestHash = repositoryRequestHash(input);
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: consult.sessionId },
    (fence) => runtime.postgres.agentConsults.complete({
      ...input,
      commandId: commandId(consult.sessionId,
        `complete:${input.consultId}`, requestHash),
      requestHash,
      fence,
    }),
  ) as Promise<
    { status: string; consult: AgentConsultDto } | { status: "not_found" }
  >;
}

export function findAgentConsult(consultId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentConsultQueries.find(consultId)
    : Promise.resolve(legacy.findAgentConsult(consultId));
}

export function findAgentConsultByOperation(operationId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentConsultQueries.findByOperation(operationId)
    : Promise.resolve(legacy.findAgentConsultByOperation(operationId));
}

export function findActiveAgentConsult(runId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentConsultQueries.findActive(runId)
    : Promise.resolve(legacy.findActiveAgentConsult(runId));
}

export function listAgentConsults(runId: string) {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentConsultQueries.list(runId)
    : Promise.resolve(legacy.listAgentConsults(runId));
}

export function listRecoverableAgentConsults() {
  const runtime = getRepositoryRuntime();
  return runtime.driver === "postgres"
    ? runtime.postgres.agentConsultQueries.listRecoverable()
    : Promise.resolve(legacy.listRecoverableAgentConsults());
}

function commandId(aggregateId: string, operation: string, requestHash: string) {
  return repositoryCommandId({
    aggregateId,
    operation: `agent-consult-${operation}`,
    version: 1,
    requestHash,
  });
}
