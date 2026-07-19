import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import type { NormalizedEnterpriseLeadImportRow } from
  "./enterprise-lead-import.js";

const envelopeVersion = "v1";

export interface EnterpriseLeadPhoneKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
  hashKey: Buffer;
}

export interface ProtectedEnterpriseLeadImportRow
  extends NormalizedEnterpriseLeadImportRow {
  id: string;
  phoneHash: string;
  phoneE164Encrypted: Buffer;
  phoneInputEncrypted: Buffer;
}

export function loadEnterpriseLeadPhoneKeyring(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseLeadPhoneKeyring | null {
  const activeKeyId = env.ENTERPRISE_MARKETING_PHONE_ACTIVE_KEY_ID?.trim() ?? "";
  const keysText = env.ENTERPRISE_MARKETING_PHONE_KEYS_JSON?.trim() ?? "";
  const hashText = env.ENTERPRISE_MARKETING_PHONE_HASH_KEY?.trim() ?? "";
  if (!activeKeyId && (!keysText || keysText === "{}") && !hashText) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(activeKeyId)) invalid();
  let raw: unknown;
  try { raw = JSON.parse(keysText); } catch { invalid(); }
  if (!plainObject(raw) || Object.keys(raw).length < 1 ||
    Object.keys(raw).some((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id))) {
    invalid();
  }
  const keys = new Map(Object.entries(raw).map(([id, value]) => [id, key(value)]));
  if (!keys.has(activeKeyId)) invalid();
  return { activeKeyId, keys, hashKey: key(hashText) };
}

export function protectEnterpriseLeadImportRow(input: {
  tenantId: string;
  id: string;
  row: NormalizedEnterpriseLeadImportRow;
  keyring: EnterpriseLeadPhoneKeyring;
}): ProtectedEnterpriseLeadImportRow {
  const phoneHash = createHmac("sha256", input.keyring.hashKey)
    .update(`${input.tenantId}\0${input.row.phoneE164}`).digest("hex");
  return { ...input.row, id: input.id, phoneHash,
    phoneE164Encrypted: seal(input.row.phoneE164, aad(input, "e164"), input.keyring),
    phoneInputEncrypted: seal(input.row.phoneInput, aad(input, "input"), input.keyring) };
}

export function openEnterpriseLeadPhone(input: {
  tenantId: string;
  id: string;
  field: "e164" | "input";
  encrypted: Buffer;
  keyring: EnterpriseLeadPhoneKeyring;
}) {
  const parts = input.encrypted.toString("utf8").split(".");
  if (parts.length !== 5 || parts[0] !== envelopeVersion) invalidEnvelope();
  const secret = input.keyring.keys.get(parts[1]!);
  if (!secret) invalidEnvelope();
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret,
      decode(parts[2]!, 12));
    decipher.setAAD(Buffer.from(aad(input, input.field), "utf8"));
    decipher.setAuthTag(decode(parts[4]!, 16));
    return Buffer.concat([decipher.update(decode(parts[3]!, 1, 256)),
      decipher.final()]).toString("utf8");
  } catch { return invalidEnvelope(); }
}

function seal(value: string, additionalData: string, keyring: EnterpriseLeadPhoneKeyring) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyring.keys.get(keyring.activeKeyId)!, nonce);
  cipher.setAAD(Buffer.from(additionalData, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.from([envelopeVersion, keyring.activeKeyId, nonce.toString("base64url"),
    encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")]
    .join("."), "utf8");
}

function aad(input: { tenantId: string; id: string }, field: "e164" | "input") {
  return `enterprise-marketing-phone:${input.tenantId}:${input.id}:${field}`;
}
function key(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) invalid();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) invalid();
  return decoded;
}
function decode(value: string, exact: number, maximum = exact) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidEnvelope();
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length < exact || decoded.length > maximum ||
    decoded.toString("base64url") !== value) invalidEnvelope();
  return decoded;
}
function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value) &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype; }
function invalid(): never { throw new Error("Enterprise marketing phone keyring is invalid"); }
function invalidEnvelope(): never { throw new Error("Enterprise marketing phone envelope is invalid"); }
