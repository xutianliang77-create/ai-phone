import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { SqliteSnapshotStore } from "./sqlite-snapshot-store.js";
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
  voiceProfiles: VoiceProfileRecord[];
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
  voiceProfiles: [],
};

export function createEmptyStoreSnapshot() {
  return structuredClone(defaultSnapshot);
}

let snapshot: AppStoreSnapshot | null = null;
let sqliteStore: SqliteSnapshotStore | null = null;

export function getStoreSnapshot() {
  if (!snapshot) snapshot = readSnapshot();
  return snapshot;
}

export function persistStoreSnapshot() {
  if (!snapshot) return;
  if (storageDriver() === "sqlite") {
    getSqliteStore().save(snapshot);
    return;
  }
  const file = dataFile();
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  renameSync(tmp, file);
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
      voiceProfiles: Array.isArray(raw.voiceProfiles) ? raw.voiceProfiles : [],
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
