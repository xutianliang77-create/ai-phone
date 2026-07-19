import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { EnterpriseMeetingCalendarPayload } from
  "./enterprise-meeting-calendar.js";

const envelopeVersion = "emc1";
const keyIdPattern = /^[A-Za-z0-9_-]{1,40}$/;

export interface EnterpriseMeetingCalendarPayloadKeyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export function loadEnterpriseMeetingCalendarPayloadKeyring(
  env: NodeJS.ProcessEnv = process.env,
): EnterpriseMeetingCalendarPayloadKeyring {
  const activeKeyId = env.ENTERPRISE_CALENDAR_PAYLOAD_ACTIVE_KEY_ID?.trim() ?? "";
  if (!keyIdPattern.test(activeKeyId)) throw new Error(
    "Enterprise calendar payload active key ID is not configured",
  );
  let raw: unknown;
  try { raw = JSON.parse(env.ENTERPRISE_CALENDAR_PAYLOAD_KEYS_JSON ?? ""); }
  catch { throw new Error("Enterprise calendar payload keyring is invalid"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Enterprise calendar payload keyring is invalid");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(raw)) {
    if (!keyIdPattern.test(keyId) || typeof encoded !== "string") {
      throw new Error("Enterprise calendar payload keyring is invalid");
    }
    keys.set(keyId, decode(encoded, 32));
  }
  if (!keys.has(activeKeyId)) throw new Error(
    "Enterprise calendar payload active key is unavailable",
  );
  return { activeKeyId, keys };
}

export function sealEnterpriseMeetingCalendarPayload(
  payload: EnterpriseMeetingCalendarPayload,
  keyring: EnterpriseMeetingCalendarPayloadKeyring,
) {
  assertPayload(payload);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > 4_096) throw invalidPayload();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyring, keyring.activeKeyId), nonce);
  cipher.setAAD(context(payload));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    payloadHash: createHash("sha256").update(plaintext).digest("hex"),
    sealedPayload: [envelopeVersion, keyring.activeKeyId,
      nonce.toString("base64url"), ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url")].join("."),
  };
}

export function openEnterpriseMeetingCalendarPayload(input: {
  tenantId: string;
  syncId: string;
  meetingId: string;
  providerEventKey: string;
  sealedPayload: string;
  payloadHash: string;
}, keyring: EnterpriseMeetingCalendarPayloadKeyring) {
  const parts = input.sealedPayload.split(".");
  if (parts.length !== 5 || parts[0] !== envelopeVersion ||
    !keyIdPattern.test(parts[1] ?? "") || !hash(input.payloadHash)) {
    throw invalidPayload();
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm", key(keyring, parts[1]!), decode(parts[2]!, 12),
    );
    const expected = { v: 1 as const, tenantId: input.tenantId,
      syncId: input.syncId, meetingId: input.meetingId,
      providerEventKey: input.providerEventKey };
    decipher.setAAD(context(expected));
    decipher.setAuthTag(decode(parts[4]!, 16));
    const plaintext = Buffer.concat([
      decipher.update(decode(parts[3]!, undefined, 1, 4_096)), decipher.final(),
    ]);
    if (createHash("sha256").update(plaintext).digest("hex") !== input.payloadHash) {
      throw invalidPayload();
    }
    const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
    assertPayload(payload);
    if (payload.tenantId !== input.tenantId || payload.syncId !== input.syncId ||
      payload.meetingId !== input.meetingId ||
      payload.providerEventKey !== input.providerEventKey) throw invalidPayload();
    return payload;
  } catch { throw invalidPayload(); }
}

function assertPayload(value: unknown): asserts value is EnterpriseMeetingCalendarPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidPayload();
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort().join(",");
  if (keys !== ["joinUrl", "meetingId", "providerEventKey", "scheduledEndAt",
    "scheduledStartAt", "syncId", "tenantId", "title", "v"].sort().join(",") ||
    item.v !== 1 || !uuid(item.tenantId) || !uuid(item.syncId) ||
    !uuid(item.meetingId) || !eventKey(item.providerEventKey) ||
    !text(item.title, 200) || !iso(item.scheduledStartAt) ||
    !iso(item.scheduledEndAt) ||
    Date.parse(item.scheduledEndAt) <= Date.parse(item.scheduledStartAt) ||
    !joinUrl(item.joinUrl, item.meetingId)) throw invalidPayload();
}

function context(input: Pick<EnterpriseMeetingCalendarPayload,
  "tenantId" | "syncId" | "meetingId" | "providerEventKey">) {
  return Buffer.from(JSON.stringify(["wujie.enterprise.meeting.calendar.v1",
    input.tenantId, input.syncId, input.meetingId, input.providerEventKey]), "utf8");
}
function key(keyring: EnterpriseMeetingCalendarPayloadKeyring, id: string) {
  const value = keyring.keys.get(id);
  if (!value || value.length !== 32) throw invalidPayload();
  return value;
}
function decode(value: string, exact?: number, minimum = exact ?? 0,
  maximum = exact ?? Number.MAX_SAFE_INTEGER) {
  const bytes = Buffer.from(value, "base64url");
  if (!value || bytes.toString("base64url") !== value ||
    exact !== undefined && bytes.length !== exact || bytes.length < minimum ||
    bytes.length > maximum) throw invalidPayload();
  return bytes;
}
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value); }
function eventKey(value: unknown): value is string { return typeof value === "string" &&
  /^[a-v0-9]{5,64}$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" &&
  /^[a-f0-9]{64}$/.test(value); }
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}
function iso(value: unknown): value is string { return typeof value === "string" &&
  Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function joinUrl(value: unknown, meetingId: unknown) {
  if (typeof value !== "string" || typeof meetingId !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username &&
    !url.password && !url.search && !url.hash &&
    url.pathname.endsWith(`/meetings/${meetingId}`); } catch { return false; }
}
function invalidPayload() { return new Error("Invalid enterprise calendar payload"); }
