import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
} from "../../infrastructure/storage/json-store.js";
import type {
  AccountConsentRecord,
  AccountConsentScene,
  AccountConsentType,
  AccountRecord,
} from "./account-record.js";

const consentTypes = new Set<AccountConsentType>([
  "initial_privacy",
  "voice_processing",
  "call_record",
  "agent_authorize",
]);
const consentScenes = new Set<AccountConsentScene>([
  "app_start",
  "realtime_online",
  "call_link",
  "ai_calling_agent",
]);

export function listAccountConsents(account: AccountRecord) {
  return getStoreSnapshot()
    .accountConsentRecords.filter((record) => record.userId === account.id)
    .map(toConsentDto);
}

export function recordAccountConsent(
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
  getStoreSnapshot().accountConsentRecords.push(record);
  persistStoreSnapshot();
  return { ok: true as const, consent: toConsentDto(record) };
}

function toConsentDto(record: AccountConsentRecord) {
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
  if (typeof value !== "string") return null;
  return consentTypes.has(value as AccountConsentType)
    ? (value as AccountConsentType)
    : null;
}

function parseConsentScene(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== "string") return false;
  return consentScenes.has(value as AccountConsentScene)
    ? (value as AccountConsentScene)
    : false;
}

function parseAcceptedAt(value: unknown, now: Date) {
  if (value === undefined) return now.toISOString();
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > maxLength) return null;
  return text;
}
