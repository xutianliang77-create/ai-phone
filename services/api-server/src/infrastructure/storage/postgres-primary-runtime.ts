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
import { PostgresAgentTasksRepository } from
  "../../modules/agent-calls/postgres-agent-tasks.repository.js";
import { PostgresBillingRepository } from
  "../../modules/billing/postgres-billing.repository.js";
import { PostgresBillingQueriesRepository } from
  "../../modules/billing/postgres-billing-queries.repository.js";
import { PostgresBillingNotificationsRepository } from
  "../../modules/billing/postgres-billing-notifications.repository.js";
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
import { PostgresWorkerDispatchOperations } from
  "../../modules/worker-dispatches/postgres-worker-dispatch-operations.js";
import { PostgresAggregateLeaseRepository } from
  "./postgres-aggregate-lease.repository.js";
import { PostgresPrimaryCommandRetention } from
  "./postgres-primary-command-retention.js";
import { PostgresProductRecordsRepository } from
  "./postgres-product-records.repository.js";
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
    reliableInbox: new PostgresReliableInboxRepository(pool),
    reliableOutbox: new PostgresReliableOutboxRepository(pool),
    productRecords: new PostgresProductRecordsRepository(pool),
    sessions: new PostgresSessionsRepository(pool),
    sessionCompletion: new PostgresSessionCompletionRepository(pool),
    usageHolds: new PostgresUsageHoldsRepository(pool),
    usageLedger: new PostgresUsageLedgerRepository(pool),
    usageQueries: new PostgresUsageQueriesRepository(pool),
    providerOperations: new PostgresProviderOperationsRepository(pool),
    workerDispatches: new PostgresWorkerDispatchRepository(pool),
    workerDispatchOperations: new PostgresWorkerDispatchOperations(pool),
    recordings: new PostgresRecordingsRepository(pool),
    recordingArtifacts: new PostgresRecordingArtifactsRepository(pool),
    ingress: new PostgresIngressRepository(pool),
    agentRuns: new PostgresAgentRunsRepository(pool),
    agentTasks: new PostgresAgentTasksRepository(pool),
    agentActions: new PostgresAgentActionsRepository(pool),
    agentHandoffs: new PostgresAgentHandoffsRepository(pool),
    agentConsults: new PostgresAgentConsultsRepository(pool),
    agentConsultQueries: new PostgresAgentConsultQueriesRepository(pool),
    billing: new PostgresBillingRepository(pool),
    billingQueries: new PostgresBillingQueriesRepository(pool),
    billingNotifications: new PostgresBillingNotificationsRepository(pool),
    close: () => pool.end(),
  };
}

export type PostgresPrimaryRuntime = ReturnType<typeof createPostgresPrimaryRuntime>;
