import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SqliteSnapshotStore,
  StorageConflictError,
} from "./sqlite-snapshot-store.js";
import type { SessionRecord } from "../../modules/sessions/session-record.js";
import type {
  AppleServerNotificationRecord,
  BillingLedgerEntry,
  PaymentOrderRecord,
} from "../../modules/billing/billing-records.js";
import type { AppErrorReportRecord } from "../../modules/diagnostics/app-error-record.js";
import type { TermbaseTermRecord } from "../../modules/terms/term-record.js";
import type { AgentCallRecord } from "../../modules/agent-calls/agent-call-record.js";
import type { UsageHoldRecord } from "../../modules/usage/usage-hold-record.js";
import type {
  AccountConsentRecord,
  AccountRecord,
  AuthSessionRecord,
  SmsOtpChallengeRecord,
} from "../../modules/account/account-record.js";
import type { VoiceProfileRecord } from "../../modules/voice-profiles/voice-profile-record.js";
import type { VoiceIdentityRecord } from "../../modules/voice-identities/voice-identity-record.js";
import type {
  InboxEventRecord,
  OutboxEventRecord,
} from "../../modules/events/event-record.js";
import type { ProviderOperationRecord } from "../../modules/provider-operations/provider-operation-record.js";
import type {
  WorkerCapacityReservationRecord,
  WorkerDispatchRecord,
} from "../../modules/worker-dispatches/worker-dispatch-record.js";
import type {
  ParticipantRecordingConsentRecord,
  RecordingArtifactRecord,
  RecordingConsentSnapshotRecord,
  RecordingJobRecord,
} from "../../modules/recordings/recording-record.js";
import type { PostgresProjectionEventRecord } from "./postgres-projection-record.js";
import type {
  AgentHandoffRecord,
  AgentRunRecord,
  AgentStepRecord,
  AgentToolExecutionRecord,
} from "../../modules/agent-calls/agent-orchestration-record.js";
import type { ExternalMediaSourceRecord } from "../../modules/ingress/ingress-record.js";
import type { AgentConsultRecord } from
  "../../modules/agent-calls/agent-consult-record.js";
import { appendPostgresProjectionEvents } from "./postgres-projection-outbox.js";

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

let snapshot: AppStoreSnapshot | null = null;
let persistedSnapshot: AppStoreSnapshot | null = null;
let sqliteStore: SqliteSnapshotStore | null = null;
let transactionDepth = 0;
let transactionDirty = false;

export function getStoreSnapshot() {
  if (!snapshot) {
    snapshot = readSnapshot();
    persistedSnapshot = structuredClone(snapshot);
  }
  return snapshot;
}

export function persistStoreSnapshot() {
  if (transactionDepth > 0) {
    transactionDirty = true;
    return;
  }
  persistStoreSnapshotNow();
}

export function runStoreTransaction<T>(operation: () => T): T {
  if (transactionDepth > 0) return operation();
  const before = structuredClone(getStoreSnapshot());
  transactionDepth = 1;
  transactionDirty = false;
  try {
    const result = operation();
    if (isPromiseLike(result)) {
      throw new Error("Store transactions must be synchronous");
    }
    if (transactionDirty) persistStoreSnapshotNow();
    return result;
  } catch (error) {
    snapshot = storageDriver() === "sqlite" && error instanceof StorageConflictError
      ? getSqliteStore().read()
      : before;
    throw error;
  } finally {
    transactionDepth = 0;
    transactionDirty = false;
  }
}

function persistStoreSnapshotNow() {
  if (!snapshot) return;
  if (persistedSnapshot) {
    appendPostgresProjectionEvents(persistedSnapshot, snapshot);
  }
  if (storageDriver() === "sqlite") {
    const store = getSqliteStore();
    try {
      store.save(snapshot);
    } catch (error) {
      snapshot = store.read();
      persistedSnapshot = structuredClone(snapshot);
      throw error;
    }
    persistedSnapshot = structuredClone(snapshot);
    return;
  }
  const file = dataFile();
  if (!file) {
    persistedSnapshot = structuredClone(snapshot);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  renameSync(tmp, file);
  persistedSnapshot = structuredClone(snapshot);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null &&
    "then" in value && typeof value.then === "function";
}

export function getStorageStatus() {
  const driver = storageDriver();
  if (driver !== "sqlite") {
    return { driver, status: driver === "memory" ? "ephemeral" : "legacy" };
  }
  const store = getSqliteStore();
  return {
    driver,
    status: store.quickCheck() === "ok" ? "ready" : "not_ready",
    journalMode: store.journalMode(),
  };
}

function readSnapshot(): AppStoreSnapshot {
  if (storageDriver() === "sqlite") {
    const store = getSqliteStore();
    const stored = store.read();
    if (!store.isEmpty()) return stored;
    const legacy = readJsonSnapshot();
    if (hasSnapshotData(legacy)) store.save(legacy);
    return legacy;
  }
  return readJsonSnapshot();
}

function readJsonSnapshot(): AppStoreSnapshot {
  const file = dataFile();
  if (!file || !existsSync(file)) return structuredClone(defaultSnapshot);
  try {
    return normalizeStoreSnapshot(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return structuredClone(defaultSnapshot);
  }
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
      voiceIdentities: Array.isArray(raw.voiceIdentities) ? raw.voiceIdentities : [],
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

function getSqliteStore() {
  sqliteStore ??= new SqliteSnapshotStore(
    sqliteFile(),
    createEmptyStoreSnapshot(),
  );
  return sqliteStore;
}

function storageDriver() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return "memory";
  const value = process.env.API_STORAGE_DRIVER?.trim().toLowerCase();
  if (!value || value === "json") return "json";
  if (value === "sqlite") return "sqlite";
  throw new Error(`Unsupported API_STORAGE_DRIVER: ${value}`);
}

function sqliteFile() {
  return resolve(process.env.API_SQLITE_FILE ?? ".data/api-store.sqlite");
}

function hasSnapshotData(value: AppStoreSnapshot) {
  return value.sessions.length > 0 ||
    value.accounts.length > 0 ||
    value.billingLedger.length > 0 ||
    Object.keys(value.usageBalances).length > 0;
}

function dataFile() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) return null;
  return resolve(process.env.API_DATA_FILE ?? ".data/api-store.json");
}
