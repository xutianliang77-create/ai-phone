import type {
  AccountConsentRecord,
  AccountRecord,
  AuthSessionRecord,
  SmsOtpChallengeRecord,
} from "../../modules/account/account-record.js";
import type { AgentCallRecord } from
  "../../modules/agent-calls/agent-call-record.js";
import type { AgentConsultRecord } from
  "../../modules/agent-calls/agent-consult-record.js";
import type {
  AgentHandoffRecord,
  AgentRunRecord,
  AgentStepRecord,
  AgentToolExecutionRecord,
} from "../../modules/agent-calls/agent-orchestration-record.js";
import type {
  AppleServerNotificationRecord,
  BillingLedgerEntry,
  PaymentOrderRecord,
} from "../../modules/billing/billing-records.js";
import type { AppErrorReportRecord } from
  "../../modules/diagnostics/app-error-record.js";
import type {
  InboxEventRecord,
  OutboxEventRecord,
} from "../../modules/events/event-record.js";
import type { ExternalMediaSourceRecord } from
  "../../modules/ingress/ingress-record.js";
import type { ProviderOperationRecord } from
  "../../modules/provider-operations/provider-operation-record.js";
import type {
  ParticipantRecordingConsentRecord,
  RecordingArtifactRecord,
  RecordingConsentSnapshotRecord,
  RecordingJobRecord,
} from "../../modules/recordings/recording-record.js";
import type { SessionRecord } from "../../modules/sessions/session-record.js";
import type { TermbaseTermRecord } from "../../modules/terms/term-record.js";
import type { UsageHoldRecord } from "../../modules/usage/usage-hold-record.js";
import type { VoiceIdentityRecord } from
  "../../modules/voice-identities/voice-identity-record.js";
import type { VoiceProfileRecord } from
  "../../modules/voice-profiles/voice-profile-record.js";
import type {
  WorkerCapacityReservationRecord,
  WorkerDispatchRecord,
} from "../../modules/worker-dispatches/worker-dispatch-record.js";
import type { PostgresProjectionEventRecord } from
  "./postgres-projection-record.js";

export interface AppStoreSnapshot {
  sessions: SessionRecord[];
  usageBalances: Record<string, number>;
  accounts: AccountRecord[];
  authSessions: AuthSessionRecord[];
  smsOtpChallenges: SmsOtpChallengeRecord[];
  accountConsentRecords: AccountConsentRecord[];
  usagePlanCodes: Record<string, string>;
  usageHolds: UsageHoldRecord[];
  entitlementPlanCodes: Record<string, string>;
  entitlementOrderIds: Record<string, string>;
  paymentOrders: PaymentOrderRecord[];
  billingLedger: BillingLedgerEntry[];
  appleServerNotifications: AppleServerNotificationRecord[];
  appErrorReports: AppErrorReportRecord[];
  termbaseTerms: TermbaseTermRecord[];
  agentCallDrafts: AgentCallRecord[];
  agentRuns: AgentRunRecord[];
  agentSteps: AgentStepRecord[];
  agentToolExecutions: AgentToolExecutionRecord[];
  agentHandoffs: AgentHandoffRecord[];
  agentConsults: AgentConsultRecord[];
  externalMediaSources: ExternalMediaSourceRecord[];
  voiceProfiles: VoiceProfileRecord[];
  voiceIdentities: VoiceIdentityRecord[];
  inboxEvents: InboxEventRecord[];
  outboxEvents: OutboxEventRecord[];
  providerOperations: ProviderOperationRecord[];
  workerDispatches: WorkerDispatchRecord[];
  workerCapacityReservations: WorkerCapacityReservationRecord[];
  participantRecordingConsents: ParticipantRecordingConsentRecord[];
  recordingConsentSnapshots: RecordingConsentSnapshotRecord[];
  recordingJobs: RecordingJobRecord[];
  recordingArtifacts: RecordingArtifactRecord[];
  postgresProjectionEvents: PostgresProjectionEventRecord[];
}

const defaultSnapshot: AppStoreSnapshot = {
  sessions: [],
  usageBalances: {},
  accounts: [],
  authSessions: [],
  smsOtpChallenges: [],
  accountConsentRecords: [],
  usagePlanCodes: {},
  usageHolds: [],
  entitlementPlanCodes: {},
  entitlementOrderIds: {},
  paymentOrders: [],
  billingLedger: [],
  appleServerNotifications: [],
  appErrorReports: [],
  termbaseTerms: [],
  agentCallDrafts: [],
  agentRuns: [],
  agentSteps: [],
  agentToolExecutions: [],
  agentHandoffs: [],
  agentConsults: [],
  externalMediaSources: [],
  voiceProfiles: [],
  voiceIdentities: [],
  inboxEvents: [],
  outboxEvents: [],
  providerOperations: [],
  workerDispatches: [],
  workerCapacityReservations: [],
  participantRecordingConsents: [],
  recordingConsentSnapshots: [],
  recordingJobs: [],
  recordingArtifacts: [],
  postgresProjectionEvents: [],
};

export function createEmptyStoreSnapshot() {
  return structuredClone(defaultSnapshot);
}

export function normalizeStoreSnapshot(value: unknown): AppStoreSnapshot {
  const raw = value && typeof value === "object"
    ? value as Partial<AppStoreSnapshot>
    : {};
  return {
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    usageBalances: raw.usageBalances ?? {},
    accounts: Array.isArray(raw.accounts) ? raw.accounts : [],
    authSessions: Array.isArray(raw.authSessions) ? raw.authSessions : [],
    smsOtpChallenges: Array.isArray(raw.smsOtpChallenges)
      ? raw.smsOtpChallenges
      : [],
    accountConsentRecords: Array.isArray(raw.accountConsentRecords)
      ? raw.accountConsentRecords
      : [],
    usagePlanCodes: raw.usagePlanCodes ?? {},
    usageHolds: Array.isArray(raw.usageHolds) ? raw.usageHolds : [],
    entitlementPlanCodes: raw.entitlementPlanCodes ?? {},
    entitlementOrderIds: raw.entitlementOrderIds ?? {},
    paymentOrders: Array.isArray(raw.paymentOrders) ? raw.paymentOrders : [],
    billingLedger: Array.isArray(raw.billingLedger) ? raw.billingLedger : [],
    appleServerNotifications: Array.isArray(raw.appleServerNotifications)
      ? raw.appleServerNotifications
      : [],
    appErrorReports: Array.isArray(raw.appErrorReports)
      ? raw.appErrorReports
      : [],
    termbaseTerms: Array.isArray(raw.termbaseTerms) ? raw.termbaseTerms : [],
    agentCallDrafts: Array.isArray(raw.agentCallDrafts)
      ? raw.agentCallDrafts
      : [],
    agentRuns: Array.isArray(raw.agentRuns) ? raw.agentRuns : [],
    agentSteps: Array.isArray(raw.agentSteps) ? raw.agentSteps : [],
    agentToolExecutions: Array.isArray(raw.agentToolExecutions)
      ? raw.agentToolExecutions
      : [],
    agentHandoffs: Array.isArray(raw.agentHandoffs) ? raw.agentHandoffs : [],
    agentConsults: Array.isArray(raw.agentConsults) ? raw.agentConsults : [],
    externalMediaSources: Array.isArray(raw.externalMediaSources)
      ? raw.externalMediaSources
      : [],
    voiceProfiles: Array.isArray(raw.voiceProfiles) ? raw.voiceProfiles : [],
    voiceIdentities: Array.isArray(raw.voiceIdentities)
      ? raw.voiceIdentities
      : [],
    inboxEvents: Array.isArray(raw.inboxEvents) ? raw.inboxEvents : [],
    outboxEvents: Array.isArray(raw.outboxEvents) ? raw.outboxEvents : [],
    providerOperations: Array.isArray(raw.providerOperations)
      ? raw.providerOperations
      : [],
    workerDispatches: Array.isArray(raw.workerDispatches)
      ? raw.workerDispatches
      : [],
    workerCapacityReservations: Array.isArray(raw.workerCapacityReservations)
      ? raw.workerCapacityReservations
      : [],
    participantRecordingConsents: Array.isArray(raw.participantRecordingConsents)
      ? raw.participantRecordingConsents
      : [],
    recordingConsentSnapshots: Array.isArray(raw.recordingConsentSnapshots)
      ? raw.recordingConsentSnapshots
      : [],
    recordingJobs: Array.isArray(raw.recordingJobs) ? raw.recordingJobs : [],
    recordingArtifacts: Array.isArray(raw.recordingArtifacts)
      ? raw.recordingArtifacts
      : [],
    postgresProjectionEvents: Array.isArray(raw.postgresProjectionEvents)
      ? raw.postgresProjectionEvents
      : [],
  };
}
