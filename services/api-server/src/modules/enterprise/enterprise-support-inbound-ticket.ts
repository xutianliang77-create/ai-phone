import { createHmac, timingSafeEqual } from "node:crypto";
import type { EnterpriseSupportInboundRoute } from "./enterprise-support-inbound.js";

interface TicketPayload extends EnterpriseSupportInboundRoute {
  issuedAt: string;
  expiresAt: string;
}

export interface EnterpriseSupportInboundTicketService {
  issue(route: EnterpriseSupportInboundRoute):
    | { status: "ready"; ticket: string; expiresAt: string }
    | { status: "not_ready" };
  verify(ticket: string):
    | { status: "verified"; payload: TicketPayload }
    | { status: "invalid" | "expired" | "not_ready" };
}

export function createEnterpriseSupportInboundTicketService(options: {
  signingSecret?: string;
  ttlSeconds?: number;
  now?: () => number;
}): EnterpriseSupportInboundTicketService {
  const secret = validSecret(options.signingSecret) ? options.signingSecret : null;
  const ttlSeconds = validTtl(options.ttlSeconds) ? options.ttlSeconds : 300;
  const now = options.now ?? Date.now;
  return {
    issue(route) {
      if (!secret || !validRoute(route)) return { status: "not_ready" };
      const issuedAt = new Date(now()).toISOString();
      const payload = { ...route, issuedAt,
        expiresAt: new Date(now() + ttlSeconds * 1_000).toISOString() };
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return { status: "ready", ticket: `${body}.${sign(body, secret)}`,
        expiresAt: payload.expiresAt };
    },
    verify(ticket) {
      if (!secret) return { status: "not_ready" };
      if (typeof ticket !== "string" || ticket.length > 4_096) {
        return { status: "invalid" };
      }
      const [body, signature, extra] = ticket.split(".");
      if (!body || !signature || extra || !safeEqual(signature, sign(body, secret))) {
        return { status: "invalid" };
      }
      try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!validPayload(payload)) return { status: "invalid" };
        const issuedAt = Date.parse(payload.issuedAt);
        const expiresAt = Date.parse(payload.expiresAt);
        if (issuedAt > now() + 30_000 || expiresAt <= now()) {
          return { status: "expired" };
        }
        return { status: "verified", payload };
      } catch { return { status: "invalid" }; }
    },
  };
}

export function createEnvironmentEnterpriseSupportInboundTicketService() {
  return createEnterpriseSupportInboundTicketService({
    signingSecret: process.env.ENTERPRISE_SUPPORT_INGRESS_SIGNING_SECRET?.trim(),
    ttlSeconds: Number(process.env.ENTERPRISE_SUPPORT_INGRESS_TICKET_TTL_SECONDS || 300),
  });
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}
function safeEqual(left: string, right: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(left)) return false;
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
function validPayload(value: unknown): value is TicketPayload {
  return Boolean(value && typeof value === "object" && validRoute(value) &&
    typeof (value as TicketPayload).issuedAt === "string" &&
    typeof (value as TicketPayload).expiresAt === "string" &&
    Number.isFinite(Date.parse((value as TicketPayload).issuedAt)) &&
    Number.isFinite(Date.parse((value as TicketPayload).expiresAt)));
}
function validRoute(value: unknown): value is EnterpriseSupportInboundRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as EnterpriseSupportInboundRoute;
  return uuid(route.tenantId) && uuid(route.channelId) &&
    ["pstn", "web", "app"].includes(route.channelType) &&
    code(route.homeRegion) && code(route.cellId) &&
    Number.isSafeInteger(route.routeEpoch) && route.routeEpoch > 0;
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function code(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(value);
}
function validSecret(value: string | undefined): value is string {
  return typeof value === "string" && Buffer.byteLength(value) >= 32;
}
function validTtl(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 60 && Number(value) <= 900;
}
