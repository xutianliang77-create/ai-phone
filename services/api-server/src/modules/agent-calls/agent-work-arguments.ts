import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const payloadVersion = "awp1";
const keyIdPattern = /^[A-Za-z0-9_-]{1,40}$/;
const maximumPlaintextBytes = 16 * 1024;

export interface AgentWorkPayloadKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface AgentWorkArgumentContext {
  workId: string;
  sessionId: string;
  actorId: string;
  toolName: string;
}

export function loadAgentWorkPayloadKeyring(
  environment: NodeJS.ProcessEnv = process.env,
): AgentWorkPayloadKeyring {
  const activeKeyId = environment.AGENT_WORK_PAYLOAD_ACTIVE_KEY_ID?.trim() ?? "";
  if (!keyIdPattern.test(activeKeyId)) {
    throw new AgentWorkArgumentError("agent_work_payload_key_id_missing");
  }
  let values: unknown;
  try {
    values = JSON.parse(environment.AGENT_WORK_PAYLOAD_KEYS_JSON ?? "");
  } catch {
    throw new AgentWorkArgumentError("agent_work_payload_keyring_invalid");
  }
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new AgentWorkArgumentError("agent_work_payload_keyring_invalid");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(values)) {
    if (!keyIdPattern.test(keyId) || typeof encoded !== "string") {
      throw new AgentWorkArgumentError("agent_work_payload_keyring_invalid");
    }
    keys.set(keyId, decodeCanonical(encoded, 32));
  }
  if (!keys.has(activeKeyId)) {
    throw new AgentWorkArgumentError("agent_work_payload_active_key_missing");
  }
  return { activeKeyId, keys };
}

export function normalizeAgentWorkArguments(
  input: unknown,
): Record<string, unknown> {
  const normalized = jsonValue(input, 0);
  if (!normalized || typeof normalized !== "object" ||
    Array.isArray(normalized)) {
    throw new AgentWorkArgumentError("agent_work_arguments_invalid");
  }
  const serialized = stableJson(normalized);
  if (Buffer.byteLength(serialized) > maximumPlaintextBytes) {
    throw new AgentWorkArgumentError("agent_work_arguments_too_large");
  }
  return normalized as Record<string, unknown>;
}

export function hashAgentWorkArguments(input: unknown) {
  return createHash("sha256")
    .update(stableJson(normalizeAgentWorkArguments(input)))
    .digest("hex");
}

export function sealAgentWorkArguments(
  context: AgentWorkArgumentContext,
  input: unknown,
  keyring = loadAgentWorkPayloadKeyring(),
) {
  const argumentsValue = normalizeAgentWorkArguments(input);
  const plaintext = Buffer.from(stableJson(argumentsValue), "utf8");
  const rootKey = requireKey(keyring, keyring.activeKeyId);
  const nonce = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    deriveKey(rootKey, "agent-work-payload:encryption:v1"),
    nonce,
  );
  cipher.setAAD(payloadContext(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    payloadVersion,
    keyring.activeKeyId,
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function openAgentWorkArguments(
  context: AgentWorkArgumentContext,
  sealed: string,
  expectedHash: string,
  keyring = loadAgentWorkPayloadKeyring(),
) {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new AgentWorkArgumentError("agent_work_arguments_hash_invalid");
  }
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== payloadVersion ||
    !keyIdPattern.test(parts[1] ?? "")) {
    throw new AgentWorkArgumentError("agent_work_payload_invalid");
  }
  try {
    const rootKey = requireKey(keyring, parts[1]!);
    const nonce = decodeCanonical(parts[2]!, 12);
    const ciphertext = decodeCanonical(
      parts[3]!,
      undefined,
      1,
      maximumPlaintextBytes + 32,
    );
    const tag = decodeCanonical(parts[4]!, 16);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(rootKey, "agent-work-payload:encryption:v1"),
      nonce,
    );
    decipher.setAAD(payloadContext(context));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    const value = normalizeAgentWorkArguments(JSON.parse(plaintext));
    if (hashAgentWorkArguments(value) !== expectedHash) {
      throw new AgentWorkArgumentError("agent_work_arguments_hash_mismatch");
    }
    return value;
  } catch (error) {
    if (error instanceof AgentWorkArgumentError) throw error;
    throw new AgentWorkArgumentError("agent_work_payload_invalid");
  }
}

export class AgentWorkArgumentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AgentWorkArgumentError";
  }
}

function payloadContext(context: AgentWorkArgumentContext) {
  return Buffer.from(stableJson([
    "ai-phone:agent-work-payload:v1",
    identifier(context.workId),
    identifier(context.sessionId),
    identifier(context.actorId),
    identifier(context.toolName, 120),
  ]), "utf8");
}

function identifier(value: unknown, maximum = 160) {
  if (typeof value !== "string" || !value.trim() ||
    Buffer.byteLength(value) > maximum) {
    throw new AgentWorkArgumentError("agent_work_payload_context_invalid");
  }
  return value.trim();
}

function requireKey(keyring: AgentWorkPayloadKeyring, keyId: string) {
  const key = keyring.keys.get(keyId);
  if (!key || key.length !== 32) {
    throw new AgentWorkArgumentError("agent_work_payload_key_unavailable");
  }
  return key;
}

function deriveKey(root: Buffer, purpose: string) {
  return createHmac("sha256", root).update(purpose).digest();
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
    throw new AgentWorkArgumentError("agent_work_payload_encoding_invalid");
  }
  return value;
}

function jsonValue(value: unknown, depth: number): unknown {
  if (depth > 8) {
    throw new AgentWorkArgumentError("agent_work_arguments_too_deep");
  }
  if (value === null || typeof value === "string" ||
    typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new AgentWorkArgumentError("agent_work_arguments_invalid");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new AgentWorkArgumentError("agent_work_arguments_too_large");
    }
    return value.map((item) => jsonValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    throw new AgentWorkArgumentError("agent_work_arguments_invalid");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) {
    throw new AgentWorkArgumentError("agent_work_arguments_too_large");
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, item] of entries) {
    if (!key || Buffer.byteLength(key) > 120 ||
      key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new AgentWorkArgumentError("agent_work_argument_key_invalid");
    }
    output[key] = jsonValue(item, depth + 1);
  }
  return output;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
