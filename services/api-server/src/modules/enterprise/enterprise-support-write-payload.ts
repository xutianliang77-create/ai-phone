import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  normalizeEnterpriseSupportWriteArguments,
  supportWriteToolName,
  type EnterpriseSupportWritePayload,
} from "./enterprise-support-write-tool.js";

const envelopeVersion = "esw1";
const keyIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export interface EnterpriseSupportWritePayloadKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export function loadEnterpriseSupportWritePayloadKeyring(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseSupportWritePayloadKeyring {
  const activeKeyId = env.ENTERPRISE_SUPPORT_WRITE_PAYLOAD_ACTIVE_KEY_ID
    ?.trim() ?? "";
  if (!keyIdPattern.test(activeKeyId)) throw invalid();
  let raw: unknown;
  try { raw = JSON.parse(env.ENTERPRISE_SUPPORT_WRITE_PAYLOAD_KEYS_JSON ?? ""); }
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

export function sealEnterpriseSupportWritePayload(
  payload: EnterpriseSupportWritePayload,
  keyring: EnterpriseSupportWritePayloadKeyring,
) {
  assertPayload(payload);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > 8_192) throw invalid();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyring,
    keyring.activeKeyId), nonce);
  cipher.setAAD(context(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { payloadHash: createHash("sha256").update(plaintext).digest("hex"),
    sealedPayload: [envelopeVersion, keyring.activeKeyId,
      nonce.toString("base64url"), ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url")].join(".") };
}

export function openEnterpriseSupportWritePayload(input: {
  tenantId: string;
  executionId: string;
  customerId: string;
  toolName: string;
  idempotencyKey: string;
  payloadHash: string;
  sealedPayload: string;
}, keyring: EnterpriseSupportWritePayloadKeyring) {
  const toolName = supportWriteToolName(input.toolName);
  if (!toolName) throw invalid();
  const parts = input.sealedPayload.split(".");
  if (parts.length !== 5 || parts[0] !== envelopeVersion ||
    !keyIdPattern.test(parts[1] ?? "") || !hash(input.payloadHash)) throw invalid();
  try {
    const decipher = createDecipheriv("aes-256-gcm",
      key(keyring, parts[1]!), decode(parts[2]!, 12));
    decipher.setAAD(context({ ...input, toolName }));
    decipher.setAuthTag(decode(parts[4]!, 16));
    const plaintext = Buffer.concat([
      decipher.update(decode(parts[3]!, undefined, 1, 8_192)), decipher.final(),
    ]);
    if (createHash("sha256").update(plaintext).digest("hex") !==
      input.payloadHash) throw invalid();
    const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
    assertPayload(payload);
    if (payload.tenantId !== input.tenantId ||
      payload.executionId !== input.executionId ||
      payload.customerId !== input.customerId ||
      payload.toolName !== input.toolName ||
      payload.idempotencyKey !== input.idempotencyKey) throw invalid();
    return payload;
  } catch { throw invalid(); }
}

function assertPayload(value: unknown): asserts value is EnterpriseSupportWritePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(",") !== ["arguments", "customerId",
    "executionId", "idempotencyKey", "tenantId", "toolName", "v"]
    .sort().join(",") || item.v !== 1 || !uuid(item.tenantId) ||
    !uuid(item.executionId) || !uuid(item.customerId) || !keyValue(item.idempotencyKey)) {
    throw invalid();
  }
  const toolName = supportWriteToolName(item.toolName);
  if (!toolName || !normalizeEnterpriseSupportWriteArguments(
    toolName, item.arguments)) throw invalid();
}

function context(input: Pick<EnterpriseSupportWritePayload,
  "tenantId" | "executionId" | "customerId" | "toolName" | "idempotencyKey">) {
  return Buffer.from(JSON.stringify(["wujie.enterprise.support.write.v1",
    input.tenantId, input.executionId, input.customerId, input.toolName,
    input.idempotencyKey]), "utf8");
}
function key(keyring: EnterpriseSupportWritePayloadKeyring, id: string) {
  const value = keyring.keys.get(id);
  if (!value || value.length !== 32) throw invalid();
  return value;
}
function decode(value: string, exact?: number, minimum = exact ?? 0,
  maximum = exact ?? Number.MAX_SAFE_INTEGER) {
  const bytes = Buffer.from(value, "base64url");
  if (!value || bytes.toString("base64url") !== value ||
    exact !== undefined && bytes.length !== exact || bytes.length < minimum ||
    bytes.length > maximum) throw invalid();
  return bytes;
}
function hash(value: unknown): value is string { return typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function keyValue(value: unknown): value is string { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value); }
function invalid() { return new Error("Invalid enterprise support write payload"); }
