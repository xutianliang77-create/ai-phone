export type PostgresProjectionNamespace =
  | "sessions"
  | "publicCreationBindings"
  | "providerOperations"
  | "workerDispatches"
  | "workerCapacityReservations"
  | "participantRecordingConsents"
  | "recordingConsentSnapshots"
  | "recordingJobs"
  | "recordingArtifacts"
  | "agentCallDrafts"
  | "agentRuns"
  | "agentSteps"
  | "agentToolExecutions"
  | "agentHandoffs"
  | "agentConsults"
  | "externalMediaSources"
  | "usageAccounts"
  | "usageHolds"
  | "billingLedger";

export interface PostgresProjectionEventRecord {
  id: string;
  namespace: PostgresProjectionNamespace;
  recordKey: string;
  operation: "upsert" | "delete";
  payload?: unknown;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string;
  lastError?: string;
}
