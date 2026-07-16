import { createHmac, timingSafeEqual } from "node:crypto";
import type { EnterpriseTenantRouteDocument } from "@translation/contracts";

export interface TenantRouteInput {
  tenantId: string;
  homeRegion: string;
  cellId: string;
}

export interface TenantPublicRoute {
  homeRegion: string;
  apiBaseUrl: string;
  rtcUrl: string;
}

export interface TenantRouteService {
  issue(input: TenantRouteInput):
    | { status: "ready"; document: EnterpriseTenantRouteDocument }
    | { status: "not_ready"; reason: string };
  verify(
    document: unknown,
    expected: TenantRouteInput,
  ):
    | { status: "verified" }
    | { status: "invalid" | "expired" | "mismatch" | "not_ready" };
}

export function createTenantRouteService(options: {
  signingSecret?: string;
  publicRoutes: Record<string, TenantPublicRoute>;
  ttlSeconds?: number;
  now?: () => number;
}): TenantRouteService {
  const now = options.now ?? Date.now;
  const ttlSeconds = validTtl(options.ttlSeconds) ? options.ttlSeconds : 300;
  const secret = validSecret(options.signingSecret) ? options.signingSecret : null;

  return {
    issue(input) {
      if (!secret) return { status: "not_ready", reason: "route_signing_not_configured" };
      const route = options.publicRoutes[input.cellId];
      if (!validPublicRoute(route) || route.homeRegion !== input.homeRegion) {
        return { status: "not_ready", reason: "public_route_not_configured" };
      }
      const issuedAt = new Date(now());
      const unsigned = {
        ...input,
        apiBaseUrl: route.apiBaseUrl,
        rtcUrl: route.rtcUrl,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + ttlSeconds * 1_000).toISOString(),
      };
      return {
        status: "ready",
        document: { ...unsigned, signature: sign(unsigned, secret) },
      };
    },
    verify(document, expected) {
      if (!secret) return { status: "not_ready" };
      if (!isRouteDocument(document)) return { status: "invalid" };
      const unsigned = unsignedDocument(document);
      if (!safeSignatureEqual(document.signature, sign(unsigned, secret))) {
        return { status: "invalid" };
      }
      if (document.tenantId !== expected.tenantId ||
        document.homeRegion !== expected.homeRegion ||
        document.cellId !== expected.cellId) {
        return { status: "mismatch" };
      }
      const issuedAt = Date.parse(document.issuedAt);
      const expiresAt = Date.parse(document.expiresAt);
      if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) ||
        issuedAt > now() + 30_000 || expiresAt <= now()) {
        return { status: "expired" };
      }
      return { status: "verified" };
    },
  };
}

export function createEnvironmentTenantRouteService() {
  return createTenantRouteService({
    signingSecret: process.env.ENTERPRISE_ROUTE_SIGNING_SECRET?.trim(),
    publicRoutes: parsePublicRoutes(process.env.ENTERPRISE_PUBLIC_ROUTES_JSON),
    ttlSeconds: Number(process.env.ENTERPRISE_ROUTE_TTL_SECONDS || 300),
  });
}

export function encodeTenantRouteDocument(document: EnterpriseTenantRouteDocument) {
  return Buffer.from(JSON.stringify(document), "utf8").toString("base64url");
}

export function decodeTenantRouteDocument(value: string) {
  if (!value || value.length > 4_096 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const document = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return isRouteDocument(document) ? document : null;
  } catch {
    return null;
  }
}

function sign(
  document: Omit<EnterpriseTenantRouteDocument, "signature">,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(JSON.stringify([
      document.tenantId,
      document.homeRegion,
      document.cellId,
      document.apiBaseUrl,
      document.rtcUrl,
      document.issuedAt,
      document.expiresAt,
    ]))
    .digest("base64url");
}

function unsignedDocument(document: EnterpriseTenantRouteDocument) {
  const { signature: _signature, ...unsigned } = document;
  return unsigned;
}

function safeSignatureEqual(left: string, right: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(left)) return false;
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isRouteDocument(value: unknown): value is EnterpriseTenantRouteDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<EnterpriseTenantRouteDocument>;
  return [
    document.tenantId,
    document.homeRegion,
    document.cellId,
    document.apiBaseUrl,
    document.rtcUrl,
    document.issuedAt,
    document.expiresAt,
    document.signature,
  ].every((item) => typeof item === "string" && item.length > 0) &&
    validEndpoint(document.apiBaseUrl!, "https:") &&
    validEndpoint(document.rtcUrl!, "wss:");
}

function validPublicRoute(value: TenantPublicRoute | undefined): value is TenantPublicRoute {
  return Boolean(value && /^[a-z][a-z0-9-]{1,31}$/.test(value.homeRegion) &&
    validEndpoint(value.apiBaseUrl, "https:") && validEndpoint(value.rtcUrl, "wss:"));
}

function validEndpoint(value: string, protocol: "https:" | "wss:") {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === protocol && !url.username && !url.password &&
      host.includes(".") && !/^\d+(\.\d+){3}$/.test(host) &&
      !host.endsWith(".local") && !host.endsWith(".internal") &&
      host !== "localhost";
  } catch {
    return false;
  }
}

function validSecret(value: string | undefined): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32;
}

function validTtl(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= 60 && value <= 900;
}

function parsePublicRoutes(raw: string | undefined) {
  if (!raw?.trim()) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, TenantPublicRoute>
      : {};
  } catch {
    return {};
  }
}
