import { Pool } from "pg";
import { PostgresAgentActionsRepository } from
  "../../modules/agent-calls/postgres-agent-actions.repository.js";
import { PostgresAgentConsultQueriesRepository } from
  "../../modules/agent-calls/postgres-agent-consult-queries.repository.js";
import { PostgresAgentConsultsRepository } from
  "../../modules/agent-calls/postgres-agent-consults.repository.js";
import { PostgresAgentHandoffsRepository } from
  "../../modules/agent-calls/postgres-agent-handoffs.repository.js";
import { PostgresAgentRunsRepository } from
  "../../modules/agent-calls/postgres-agent-runs.repository.js";
import { PostgresIngressRepository } from
  "../../modules/ingress/postgres-ingress.repository.js";
import { PostgresProviderOperationsRepository } from
  "../../modules/provider-operations/postgres-provider-operations.repository.js";
import { PostgresRecordingArtifactsRepository } from
  "../../modules/recordings/postgres-recording-artifacts.repository.js";
import { PostgresRecordingsRepository } from
  "../../modules/recordings/postgres-recordings.repository.js";
import { PostgresSessionCompletionRepository } from
  "../../modules/sessions/postgres-session-completion.repository.js";
import { PostgresSessionsRepository } from
  "../../modules/sessions/postgres-sessions.repository.js";
import { PostgresUsageHoldsRepository } from
  "../../modules/usage/postgres-usage-holds.repository.js";
import { PostgresUsageLedgerRepository } from
  "../../modules/usage/postgres-usage-ledger.repository.js";
import { PostgresUsageQueriesRepository } from
  "../../modules/usage/postgres-usage-queries.repository.js";
import { PostgresWorkerDispatchRepository } from
  "../../modules/worker-dispatches/postgres-worker-dispatch.repository.js";
import { PostgresAggregateLeaseRepository } from
  "./postgres-aggregate-lease.repository.js";
import { PostgresPrimaryCommandRetention } from
  "./postgres-primary-command-retention.js";
import { buildPostgresPrimaryPoolConfig } from "./postgres-projection-config.js";
import { PostgresReliableInboxRepository } from
  "./postgres-reliable-inbox.repository.js";
import { PostgresReliableOutboxRepository } from
  "./postgres-reliable-outbox.repository.js";

export function createPostgresPrimaryRuntime() {
  const pool = new Pool(buildPostgresPrimaryPoolConfig());
  return {
    pool,
    leases: new PostgresAggregateLeaseRepository(pool),
    commandRetention: new PostgresPrimaryCommandRetention(pool),
    reliableInbox: new PostgresReliableInboxRepository(),
    reliableOutbox: new PostgresReliableOutboxRepository(pool),
    sessions: new PostgresSessionsRepository(pool),
    sessionCompletion: new PostgresSessionCompletionRepository(pool),
    usageHolds: new PostgresUsageHoldsRepository(pool),
    usageLedger: new PostgresUsageLedgerRepository(pool),
    usageQueries: new PostgresUsageQueriesRepository(pool),
    providerOperations: new PostgresProviderOperationsRepository(pool),
    workerDispatches: new PostgresWorkerDispatchRepository(pool),
    recordings: new PostgresRecordingsRepository(pool),
    recordingArtifacts: new PostgresRecordingArtifactsRepository(pool),
    ingress: new PostgresIngressRepository(pool),
    agentRuns: new PostgresAgentRunsRepository(pool),
    agentActions: new PostgresAgentActionsRepository(pool),
    agentHandoffs: new PostgresAgentHandoffsRepository(pool),
    agentConsults: new PostgresAgentConsultsRepository(pool),
    agentConsultQueries: new PostgresAgentConsultQueriesRepository(pool),
    close: () => pool.end(),
  };
}

export type PostgresPrimaryRuntime = ReturnType<typeof createPostgresPrimaryRuntime>;
