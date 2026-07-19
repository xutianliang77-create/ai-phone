import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";

const referenceVersion = "aph1";
const keyIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export interface AgentPhoneReferenceKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export function loadAgentPhoneReferenceKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): AgentPhoneReferenceKeyring {
  const activeKeyId = environment.AGENT_PHONE_REFERENCE_ACTIVE_KEY_ID?.trim() ?? "";
  if (!keyIdPattern.test(activeKeyId)) {
    throw new Error("Agent phone reference active key ID is not configured");
  }
  let values: unknown;
  try {
    values = JSON.parse(environment.AGENT_PHONE_REFERENCE_KEYS_JSON ?? "");
  } catch {
    throw new Error("Agent phone reference keyring is invalid");
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Agent phone reference keyring is invalid");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(values)) {
    if (!keyIdPattern.test(keyId) || typeof encoded !== "string") {
      throw new Error("Agent phone reference keyring is invalid");
    }
    keys.set(keyId, decodeKey(encoded));
  }
  if (!keys.has(activeKeyId)) {
    throw new Error("Agent phone reference active key is unavailable");
  }
  return { activeKeyId, keys };
}

export function sealAgentPhoneReference(
  input: { userId: string; draftId: string; phone: string },
  keyring = loadAgentPhoneReferenceKeyring(),
) {
  const context = phoneContext(input.userId, input.draftId);
  if (!input.phone || Buffer.byteLength(input.phone) > 32) {
    throw new Error("Agent phone number is invalid");
  }
  const rootKey = requireKey(keyring, keyring.activeKeyId);
  const encryptionKey = deriveKey(rootKey, "agent-phone:encryption:v1");
  const nonceKey = deriveKey(rootKey, "agent-phone:nonce:v1");
  const plaintext = Buffer.from(input.phone, "utf8");
  const nonce = createHmac("sha256", nonceKey)
    .update(context).update(Buffer.of(0)).update(plaintext).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    referenceVersion,
    keyring.activeKeyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function openAgentPhoneReference(
  input: { userId: string; draftId: string; reference: string },
  keyring = loadAgentPhoneReferenceKeyring(),
) {
  const parts = input.reference.split(".");
  if (parts.length !== 5 || parts[0] !== referenceVersion ||
    !keyIdPattern.test(parts[1] ?? "")) {
    throw invalidReference();
  }
  try {
    const rootKey = requireKey(keyring, parts[1]!);
    const nonce = decodeCanonical(parts[2]!, 12);
    const ciphertext = decodeCanonical(parts[3]!, undefined, 1, 48);
    const authTag = decodeCanonical(parts[4]!, 16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(rootKey, "agent-phone:encryption:v1"),
      nonce,
    );
    decipher.setAAD(phoneContext(input.userId, input.draftId));
    decipher.setAuthTag(authTag);
    const phone = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    if (!phone || Buffer.byteLength(phone) > 32) throw invalidReference();
    return phone;
  } catch {
    throw invalidReference();
  }
}

export function isAgentPhoneReference(value: unknown): value is string {
  if (typeof value !== "string" || Buffer.byteLength(value) > 512) return false;
  const parts = value.split(".");
  return parts.length === 5 && parts[0] === referenceVersion &&
    keyIdPattern.test(parts[1] ?? "") &&
    canonicalLength(parts[2], 12) && canonicalLength(parts[3], undefined, 1, 48) &&
    canonicalLength(parts[4], 16);
}

export function protectAgentCallPrimaryPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Agent call primary payload");
  }
  const payload = structuredClone(value) as Record<string, unknown>;
  const userId = identifier(payload.userId, "user ID");
  const draftId = identifier(payload.id, "draft ID");
  const phone = typeof payload.targetPhone === "string"
    ? payload.targetPhone.trim() : "";
  delete payload.targetPhone;
  if (phone) {
    payload.targetPhoneReference = sealAgentPhoneReference({ userId, draftId, phone });
  } else if (payload.targetPhoneReference !== undefined &&
    !isAgentPhoneReference(payload.targetPhoneReference)) {
    throw new Error("Invalid Agent phone reference");
  }
  payload.version = positiveVersion(payload.version);
  payload.idempotencyKey = boundedString(payload.idempotencyKey, 200) ??
    `import:${draftId}`;
  payload.requestHash = boundedRequestHash(payload.requestHash) ??
    createHash("sha256").update(stableJson(payload)).digest("hex");
  return payload;
}

function phoneContext(userId: string, draftId: string) {
  return Buffer.from(JSON.stringify([
    "ai-phone:agent-phone:v1",
    identifier(userId, "user ID"),
    identifier(draftId, "draft ID"),
  ]), "utf8");
}

function identifier(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > 200) {
    throw new Error(`Agent phone reference ${label} is invalid`);
  }
  return value;
}

function requireKey(keyring: AgentPhoneReferenceKeyring, keyId: string) {
  const key = keyring.keys.get(keyId);
  if (!key || key.length !== 32) throw invalidReference();
  return key;
}

function deriveKey(rootKey: Buffer, purpose: string) {
  return createHmac("sha256", rootKey).update(purpose).digest();
}

function decodeKey(encoded: string) {
  return decodeCanonical(encoded, 32);
}

function decodeCanonical(
  encoded: string,
  exactLength?: number,
  minimumLength = exactLength ?? 0,
  maximumLength = exactLength ?? Number.MAX_SAFE_INTEGER,
) {
  const value = Buffer.from(encoded, "base64url");
  if (value.toString("base64url") !== encoded ||
    (exactLength !== undefined && value.length !== exactLength) ||
    value.length < minimumLength || value.length > maximumLength) {
    throw invalidReference();
  }
  return value;
}

function canonicalLength(
  encoded: string | undefined,
  exactLength?: number,
  minimumLength?: number,
  maximumLength?: number,
) {
  if (!encoded) return false;
  try {
    decodeCanonical(encoded, exactLength, minimumLength, maximumLength);
    return true;
  } catch {
    return false;
  }
}

function invalidReference() {
  return new Error("Invalid Agent phone reference");
}

function positiveVersion(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() &&
      Buffer.byteLength(value) <= maximum ? value : undefined;
}

function boundedRequestHash(value: unknown) {
  const hash = boundedString(value, 128);
  return hash && hash.length >= 16 ? hash : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
}
