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
import { PostgresAgentVoiceTurnsRepository } from
  "../../modules/agent-calls/postgres-agent-voice-turns.repository.js";
import { PostgresAgentTasksRepository } from
  "../../modules/agent-calls/postgres-agent-tasks.repository.js";
import { PostgresAgentWorksRepository } from
  "../../modules/agent-calls/postgres-agent-works.repository.js";
import { PostgresAgentWorkPermissionsRepository } from
  "../../modules/agent-calls/postgres-agent-work-permissions.repository.js";
import { PostgresVoiceClientOwnershipRepository } from
  "../../modules/agent-calls/postgres-voice-client-ownership.repository.js";
import { PostgresAgentDeliveriesRepository } from
  "../../modules/agent-calls/postgres-agent-delivery.repository.js";
import { PostgresAgentDeliveryUpdates } from
  "../../modules/agent-calls/postgres-agent-delivery-updates.js";
import { PostgresAgentDeliveryClientEventsRepository } from
  "../../modules/agent-calls/postgres-agent-delivery-client-events.repository.js";
import { PostgresBillingRepository } from
  "../../modules/billing/postgres-billing.repository.js";
import { PostgresBillingQueriesRepository } from
  "../../modules/billing/postgres-billing-queries.repository.js";
import { PostgresBillingNotificationsRepository } from
  "../../modules/billing/postgres-billing-notifications.repository.js";
import { PostgresAirDeviceCallsRepository } from
  "../../modules/device-calls/postgres-air-device-calls.repository.js";
import { PostgresAirDeviceCallEvents } from
  "../../modules/device-calls/postgres-air-device-call-events.js";
import { PostgresAirDeviceRegistryRepository } from
  "../../modules/device-calls/postgres-air-device-registry.repository.js";
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
  const reliableInbox = new PostgresReliableInboxRepository(pool);
  const reliableOutbox = new PostgresReliableOutboxRepository(pool);
  return {
    pool,
    leases: new PostgresAggregateLeaseRepository(pool),
    commandRetention: new PostgresPrimaryCommandRetention(pool),
    reliableInbox,
    reliableOutbox,
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
    agentWorks: new PostgresAgentWorksRepository(pool),
    agentWorkPermissions: new PostgresAgentWorkPermissionsRepository(pool),
    agentVoiceTurns: new PostgresAgentVoiceTurnsRepository(pool),
    voiceClientOwnerships: new PostgresVoiceClientOwnershipRepository(pool),
    agentDeliveries: new PostgresAgentDeliveriesRepository(pool),
    agentDeliveryUpdates: new PostgresAgentDeliveryUpdates(pool),
    agentDeliveryClientEvents:
      new PostgresAgentDeliveryClientEventsRepository(pool),
    agentActions: new PostgresAgentActionsRepository(pool),
    agentHandoffs: new PostgresAgentHandoffsRepository(pool),
    agentConsults: new PostgresAgentConsultsRepository(pool),
    agentConsultQueries: new PostgresAgentConsultQueriesRepository(pool),
    billing: new PostgresBillingRepository(pool),
    billingQueries: new PostgresBillingQueriesRepository(pool),
    billingNotifications: new PostgresBillingNotificationsRepository(pool),
    airDeviceRegistry: new PostgresAirDeviceRegistryRepository(pool),
    airDeviceCalls: new PostgresAirDeviceCallsRepository(pool),
    airDeviceCallEvents: new PostgresAirDeviceCallEvents({
      inbox: reliableInbox,
      outbox: reliableOutbox,
    }),
    close: () => pool.end(),
  };
}

export type PostgresPrimaryRuntime = ReturnType<typeof createPostgresPrimaryRuntime>;
