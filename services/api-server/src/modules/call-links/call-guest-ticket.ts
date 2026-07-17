import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  getStoreSnapshot,
  persistStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import type { CallGuestTicketRecord } from "./call-link-record.js";

export type GuestTicketFailure =
  | "invalid_guest_ticket"
  | "guest_ticket_expired"
  | "guest_ticket_already_used";

export function issueCallGuestTicket(options: {
  callId: string;
  sessionId: string;
  callExpiresAt: string;
  ttlSeconds: number;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const nonce = randomBytes(18).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const ticket = `g1.${nonce}.${secret}`;
  const expiresAt = new Date(Math.min(
    Date.parse(options.callExpiresAt),
    now.getTime() + options.ttlSeconds * 1000,
  )).toISOString();
  const record: CallGuestTicketRecord = {
    callId: options.callId,
    sessionId: options.sessionId,
    role: "guest",
    nonceHash: digest(nonce),
    ticketHash: digest(ticket),
    issuedAt: now.toISOString(),
    expiresAt,
  };
  return { ticket, record };
}

export function inspectCallGuestTicket(options: {
  callId: string;
  sessionId: string;
  ticket: string;
  record?: CallGuestTicketRecord;
  now?: Date;
}): { ok: true } | { ok: false; code: GuestTicketFailure } {
  const record = options.record;
  const parts = parseTicket(options.ticket);
  if (!record || !parts || record.callId !== options.callId ||
    record.sessionId !== options.sessionId || record.role !== "guest" ||
    !safeEqual(record.nonceHash, digest(parts.nonce)) ||
    !safeEqual(record.ticketHash, digest(options.ticket))) {
    return { ok: false, code: "invalid_guest_ticket" };
  }
  if (record.consumedAt) {
    return { ok: false, code: "guest_ticket_already_used" };
  }
  if ((options.now ?? new Date()).getTime() >= Date.parse(record.expiresAt)) {
    return { ok: false, code: "guest_ticket_expired" };
  }
  return { ok: true };
}

export function consumeCallGuestTicket(options: {
  callId: string;
  sessionId: string;
  ticket: string;
  now?: Date;
}) {
  return runStoreTransaction(() => {
    const session = getStoreSnapshot().sessions.find(
      (item) => item.id === options.sessionId && item.mode === "call_link",
    );
    const inspected = inspectCallGuestTicket({
      ...options,
      record: session?.callLink?.guestTicket,
    });
    if (!inspected.ok || !session?.callLink?.guestTicket) return inspected;
    const consumedAt = (options.now ?? new Date()).toISOString();
    session.callLink.guestTicket.consumedAt = consumedAt;
    session.lastActivityAt = consumedAt;
    session.version = (session.version ?? 0) + 1;
    persistStoreSnapshot();
    return { ok: true as const, consumedAt };
  });
}

export function replaceCallGuestTicket(
  sessionId: string,
  record: CallGuestTicketRecord,
) {
  return runStoreTransaction(() => {
    const session = getStoreSnapshot().sessions.find(
      (item) => item.id === sessionId && item.mode === "call_link",
    );
    if (!session?.callLink || session.status === "ended") return false;
    session.callLink.guestTicket = record;
    session.lastActivityAt = record.issuedAt;
    session.version = (session.version ?? 0) + 1;
    persistStoreSnapshot();
    return true;
  });
}

export function guestJoinUrl(baseUrl: string, ticket: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

function parseTicket(ticket: string) {
  if (ticket.length > 160) return null;
  const [version, nonce, secret, extra] = ticket.split(".");
  if (version !== "g1" || !nonce || !secret || extra !== undefined) return null;
  if (!/^[A-Za-z0-9_-]{20,32}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(secret)) return null;
  return { nonce };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer);
}
