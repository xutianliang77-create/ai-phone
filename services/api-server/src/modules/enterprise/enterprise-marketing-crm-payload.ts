import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EnterpriseMarketingCrmPayload } from "./enterprise-marketing-crm.js";

const version = "emcrm1";
const keyIdPattern = /^[A-Za-z0-9_-]{1,40}$/;
export interface EnterpriseMarketingCrmPayloadKeyring {
  activeKeyId: string; keys: ReadonlyMap<string, Buffer>;
}

export function loadEnterpriseMarketingCrmPayloadKeyring(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseMarketingCrmPayloadKeyring {
  const activeKeyId = env.ENTERPRISE_MARKETING_CRM_PAYLOAD_ACTIVE_KEY_ID?.trim() ?? "";
  if (!keyIdPattern.test(activeKeyId)) throw invalid();
  let raw: unknown;
  try { raw = JSON.parse(env.ENTERPRISE_MARKETING_CRM_PAYLOAD_KEYS_JSON ?? ""); }
  catch { throw invalid(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(raw)) {
    if (!keyIdPattern.test(keyId) || typeof encoded !== "string") throw invalid();
    keys.set(keyId, decode(encoded, 32));
  }
  if (!keys.has(activeKeyId)) throw invalid();
  return { activeKeyId, keys };
}

export function sealEnterpriseMarketingCrmPayload(
  payload: EnterpriseMarketingCrmPayload,
  keyring: EnterpriseMarketingCrmPayloadKeyring,
) {
  assertPayload(payload);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > 8_192) throw invalid();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyring, keyring.activeKeyId), nonce);
  cipher.setAAD(context(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { payloadHash: createHash("sha256").update(plaintext).digest("hex"),
    sealedPayload: [version, keyring.activeKeyId, nonce.toString("base64url"),
      ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")]
      .join(".") };
}

export function openEnterpriseMarketingCrmPayload(input: {
  tenantId: string; syncId: string; campaignId: string; outcomeId: string;
  externalRecordKey: string; sealedPayload: string; payloadHash: string;
}, keyring: EnterpriseMarketingCrmPayloadKeyring) {
  const parts = input.sealedPayload.split(".");
  if (parts.length !== 5 || parts[0] !== version ||
    !keyIdPattern.test(parts[1] ?? "") || !hash(input.payloadHash)) throw invalid();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(keyring, parts[1]!),
      decode(parts[2]!, 12));
    decipher.setAAD(context(input));
    decipher.setAuthTag(decode(parts[4]!, 16));
    const plaintext = Buffer.concat([decipher.update(decode(parts[3]!, undefined,
      1, 8_192)), decipher.final()]);
    if (createHash("sha256").update(plaintext).digest("hex") !== input.payloadHash) {
      throw invalid();
    }
    const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
    assertPayload(payload);
    for (const field of ["tenantId", "syncId", "campaignId", "outcomeId",
      "externalRecordKey"] as const) if (payload[field] !== input[field]) throw invalid();
    return payload;
  } catch { throw invalid(); }
}

function assertPayload(value: unknown): asserts value is EnterpriseMarketingCrmPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  const allowed = ["v", "tenantId", "syncId", "campaignId", "outcomeId",
    "externalRecordKey", "disposition", "intentLevel", "summary", "evidenceHash",
    "sourceHash", "leadId", "phoneHint", "nextAction", "outcomeCreatedAt"];
  if (Object.keys(item).some((name) => !allowed.includes(name)) || item.v !== 1 ||
    !uuid(item.tenantId) || !uuid(item.syncId) || !uuid(item.campaignId) ||
    !uuid(item.outcomeId) || !uuid(item.leadId) || !externalKey(item.externalRecordKey) ||
    !text(item.disposition, 40) || !text(item.intentLevel, 20) ||
    !text(item.summary, 2_000) || !hash(item.evidenceHash) || !hash(item.sourceHash) ||
    !text(item.phoneHint, 80) || !iso(item.outcomeCreatedAt) ||
    item.nextAction !== undefined && !validNextAction(item.nextAction)) throw invalid();
}
function validNextAction(value: unknown) { if (!value || typeof value !== "object" ||
  Array.isArray(value)) return false; const item = value as Record<string, unknown>;
  return Object.keys(item).every((name) => ["kind", "dueAt"].includes(name)) &&
    text(item.kind, 40) && (item.dueAt === undefined || iso(item.dueAt)); }
function context(input: Pick<EnterpriseMarketingCrmPayload, "tenantId" | "syncId" |
  "campaignId" | "outcomeId" | "externalRecordKey">) { return Buffer.from(JSON.stringify([
    "wujie.enterprise.marketing.crm.v1", input.tenantId, input.syncId,
    input.campaignId, input.outcomeId, input.externalRecordKey]), "utf8"); }
function key(keyring: EnterpriseMarketingCrmPayloadKeyring, id: string) { const value =
  keyring.keys.get(id); if (!value || value.length !== 32) throw invalid(); return value; }
function decode(value: string, exact?: number, minimum = exact ?? 0,
  maximum = exact ?? Number.MAX_SAFE_INTEGER) { const bytes = Buffer.from(value, "base64url");
  if (!value || bytes.toString("base64url") !== value || exact !== undefined &&
    bytes.length !== exact || bytes.length < minimum || bytes.length > maximum) throw invalid();
  return bytes; }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value); }
function externalKey(value: unknown): value is string { return typeof value === "string" &&
  /^wujie_[a-f0-9]{48}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value); }
function text(value: unknown, max: number): value is string { return typeof value === "string" &&
  value.trim() === value && value.length > 0 && Buffer.byteLength(value) <= max; }
function iso(value: unknown): value is string { return typeof value === "string" &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function invalid() { return new Error("Invalid enterprise marketing CRM payload"); }
