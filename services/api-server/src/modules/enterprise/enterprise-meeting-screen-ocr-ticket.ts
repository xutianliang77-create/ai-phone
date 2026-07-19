import { createHmac, timingSafeEqual } from "node:crypto";

export interface EnterpriseMeetingScreenOcrTicketPayload {
  v: 1;
  runId: string;
  tenantId: string;
  meetingId: string;
  communicationSessionId: string;
  shareId: string;
  shareGeneration: number;
  publisherIdentity: string;
  trackSid: string;
  targetLanguage: "zh" | "en";
  cellId: string;
  routeEpoch: number;
  issuedAt: string;
  expiresAt: string;
}

export function issueEnterpriseMeetingScreenOcrTicket(input: {
  payload: EnterpriseMeetingScreenOcrTicketPayload;
  signingSecret: string;
}) {
  assertSecret(input.signingSecret);
  if (!validPayload(input.payload)) throw new Error("Invalid screen OCR ticket");
  const encoded = Buffer.from(JSON.stringify(input.payload)).toString("base64url");
  return `${encoded}.${signature(encoded, input.signingSecret)}`;
}

export function verifyEnterpriseMeetingScreenOcrTicket(input: {
  ticket: string;
  signingSecret: string;
  now?: Date;
}) {
  assertSecret(input.signingSecret);
  if (Buffer.byteLength(input.ticket) > 4_096) return null;
  const [encoded, supplied, extra] = input.ticket.split(".");
  if (!encoded || !supplied || extra) return null;
  const expected = Buffer.from(signature(encoded, input.signingSecret));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as unknown;
    if (!validPayload(payload)) return null;
    const now = (input.now ?? new Date()).getTime();
    return Date.parse(payload.issuedAt) <= now + 30_000 &&
      Date.parse(payload.expiresAt) > now ? payload : null;
  } catch {
    return null;
  }
}

export function screenOcrTicketSecret(env = process.env) {
  const value = env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? "";
  assertSecret(value);
  return value;
}

function validPayload(value: unknown): value is EnterpriseMeetingScreenOcrTicketPayload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const issued = iso(item.issuedAt);
  const expires = iso(item.expiresAt);
  return item.v === 1 && uuid(item.runId) && uuid(item.tenantId) &&
    uuid(item.meetingId) && uuid(item.communicationSessionId) &&
    uuid(item.shareId) && positive(item.shareGeneration) &&
    bounded(item.publisherIdentity, 200) && bounded(item.trackSid, 128) &&
    ["zh", "en"].includes(String(item.targetLanguage)) && code(item.cellId) &&
    positive(item.routeEpoch) && issued !== null && expires !== null &&
    expires > issued && expires - issued <= 300_000;
}

function signature(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}
function assertSecret(value: string) {
  if (Buffer.byteLength(value) < 32) throw new Error(
    "ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET must be at least 32 bytes",
  );
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}
function code(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}
function iso(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed : null;
}
