import { randomUUID } from "node:crypto";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type {
  AccountConsentRecord,
  AccountConsentScene,
  AccountConsentType,
  AccountRecord,
} from "./account-record.js";
import * as legacy from "./account-consent.service.js";

const consentTypes = new Set<AccountConsentType>([
  "initial_privacy", "voice_processing", "call_record", "agent_authorize",
]);
const consentScenes = new Set<AccountConsentScene>([
  "app_start", "realtime_online", "call_link", "ai_calling_agent",
]);

export async function listAccountConsents(account: AccountRecord) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.listAccountConsents(account);
  const records = await runtime.postgres.productRecords.query<AccountConsentRecord>({
    namespace: "accountConsents", ownerId: account.id, limit: 500,
  });
  return records.map(toDto);
}

export async function recordAccountConsent(
  account: AccountRecord,
  input: Partial<{
    consentType: unknown;
    version: unknown;
    scene: unknown;
    acceptedAt: unknown;
    source: unknown;
    locale: unknown;
  }>,
  now = new Date(),
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver !== "postgres") return legacy.recordAccountConsent(account, input, now);
  const consentType = parseConsentType(input.consentType);
  const version = cleanText(input.version, 120);
  const scene = parseConsentScene(input.scene);
  const source = cleanText(input.source, 40) ?? "mobile";
  const locale = cleanText(input.locale, 16);
  const acceptedAt = parseAcceptedAt(input.acceptedAt, now);
  if (!consentType || !version || scene === false || !acceptedAt) {
    return { ok: false as const, code: "invalid_consent" };
  }
  const record: AccountConsentRecord = {
    id: `consent_${randomUUID()}`,
    userId: account.id,
    consentType,
    version,
    scene: scene ?? undefined,
    acceptedAt,
    recordedAt: now.toISOString(),
    source,
    locale: locale ?? undefined,
  };
  const requestHash = repositoryRequestHash(record);
  const result = await withPostgresRepositoryFence(
    { aggregateType: "account", aggregateId: account.id },
    (fence) => runtime.postgres.productRecords.mutate<AccountConsentRecord>({
      namespace: "accountConsents",
      recordKey: record.id,
      commandId: repositoryCommandId({ aggregateId: account.id,
        operation: `account-consent:${record.id}`, version: 1, requestHash }),
      commandType: "account.consent.record",
      requestHash,
      eventType: "account.consent.recorded",
      fence,
      mutate: (current) => current ?? record,
    }),
  );
  return result.record
    ? { ok: true as const, consent: toDto(result.record) }
    : { ok: false as const, code: "invalid_consent" };
}

function toDto(record: AccountConsentRecord) {
  return {
    id: record.id,
    consentType: record.consentType,
    version: record.version,
    scene: record.scene,
    acceptedAt: record.acceptedAt,
    recordedAt: record.recordedAt,
    source: record.source,
    locale: record.locale,
  };
}

function parseConsentType(value: unknown) {
  return typeof value === "string" && consentTypes.has(value as AccountConsentType)
    ? value as AccountConsentType : null;
}
function parseConsentScene(value: unknown) {
  if (value === undefined) return null;
  return typeof value === "string" && consentScenes.has(value as AccountConsentScene)
    ? value as AccountConsentScene : false;
}
function parseAcceptedAt(value: unknown, now: Date) {
  if (value === undefined) return now.toISOString();
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null;
}
function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maximum ? text : null;
}
