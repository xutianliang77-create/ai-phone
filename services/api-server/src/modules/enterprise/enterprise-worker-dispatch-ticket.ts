import { createHmac, timingSafeEqual } from "node:crypto";

export const enterpriseWorkerCapabilities = [
  "translation_runtime",
  "voice_agent_runtime",
] as const;

export type EnterpriseWorkerCapability =
  (typeof enterpriseWorkerCapabilities)[number];

export interface EnterpriseWorkerDispatchTicketPayload {
  v: 1;
  ticketId: string;
  tenantId: string;
  communicationSessionId: string;
  cellId: string;
  routeEpoch: number;
  generation: number;
  capability: EnterpriseWorkerCapability;
  issuedAt: string;
  expiresAt: string;
}

export function issueEnterpriseWorkerDispatchTicket(input: {
  payload: EnterpriseWorkerDispatchTicketPayload;
  signingSecret: string;
}) {
  assertSigningSecret(input.signingSecret);
  if (!validPayload(input.payload)) {
    throw new Error("Invalid enterprise worker dispatch ticket payload");
  }
  const encoded = Buffer.from(JSON.stringify(input.payload)).toString("base64url");
  return `${encoded}.${sign(encoded, input.signingSecret)}`;
}

export function verifyEnterpriseWorkerDispatchTicket(input: {
  ticket: string;
  signingSecret: string;
  now?: Date;
}): EnterpriseWorkerDispatchTicketPayload | null {
  assertSigningSecret(input.signingSecret);
  if (input.ticket.length > 4096) return null;
  const [encoded, provided, extra] = input.ticket.split(".");
  if (!encoded || !provided || extra) return null;
  const expected = sign(encoded, input.signingSecret);
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    if (!validPayload(payload)) return null;
    const now = input.now ?? new Date();
    return Date.parse(payload.issuedAt) <= now.getTime() + 30_000 &&
        Date.parse(payload.expiresAt) > now.getTime()
      ? payload
      : null;
  } catch {
    return null;
  }
}

export function assertEnterpriseWorkerTicketSecret(value: string) {
  assertSigningSecret(value);
  return value;
}

function validPayload(
  value: unknown,
): value is EnterpriseWorkerDispatchTicketPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const issuedAt = isoTime(item.issuedAt);
  const expiresAt = isoTime(item.expiresAt);
  return item.v === 1 && uuid(item.ticketId) && uuid(item.tenantId) &&
    bounded(item.communicationSessionId, 200) && code(item.cellId) &&
    positive(item.routeEpoch) && positive(item.generation) &&
    enterpriseWorkerCapabilities.includes(
      item.capability as EnterpriseWorkerCapability,
    ) && issuedAt !== null && expiresAt !== null && expiresAt > issuedAt &&
    expiresAt - issuedAt <= 300_000;
}

function assertSigningSecret(value: string) {
  if (Buffer.byteLength(value.trim()) < 32) {
    throw new Error(
      "ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET must be at least 32 bytes",
    );
  }
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function code(value: unknown): value is string {
  return typeof value === "string" &&
    /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}

function bounded(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maxBytes;
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isoTime(value: unknown) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}
