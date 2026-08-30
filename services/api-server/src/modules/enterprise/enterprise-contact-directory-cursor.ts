import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  EnterpriseContactDirectoryKind,
  EnterpriseContactDirectoryPosition,
} from "./enterprise-contact-directory.js";

export interface EnterpriseContactDirectoryCursorBinding {
  tenantId: string;
  kind: EnterpriseContactDirectoryKind;
}

export interface EnterpriseContactDirectoryCursorService {
  readonly ready: boolean;
  issue(binding: EnterpriseContactDirectoryCursorBinding,
    position: EnterpriseContactDirectoryPosition):
      { status: "ready"; cursor: string } | { status: "not_ready" };
  verify(cursor: string, binding: EnterpriseContactDirectoryCursorBinding):
    | { status: "valid"; position: EnterpriseContactDirectoryPosition }
    | { status: "invalid" | "expired" | "not_ready" };
}

export function createEnterpriseContactDirectoryCursorService(options: {
  signingSecret?: string;
  ttlSeconds?: number;
  now?: () => number;
}): EnterpriseContactDirectoryCursorService {
  const secret = validSecret(options.signingSecret)
    ? options.signingSecret : undefined;
  const ttlSeconds = options.ttlSeconds ?? 900;
  const ready = Boolean(secret && validTtl(ttlSeconds));
  const now = options.now ?? Date.now;
  return {
    ready,
    issue(binding, position) {
      if (!secret || !ready) return { status: "not_ready" };
      const payload: CursorPayload = {
        version: 1,
        tenantId: binding.tenantId,
        kind: binding.kind,
        updatedAt: position.updatedAt,
        id: position.id,
        expiresAt: now() + ttlSeconds * 1_000,
      };
      const encoded = Buffer.from(JSON.stringify(payload), "utf8")
        .toString("base64url");
      return { status: "ready", cursor: `${encoded}.${sign(encoded, secret)}` };
    },
    verify(cursor, binding) {
      if (!secret || !ready) return { status: "not_ready" };
      const [encoded, supplied, extra] = cursor.split(".");
      if (!encoded || !supplied || extra ||
        !sameSignature(supplied, sign(encoded, secret))) {
        return { status: "invalid" };
      }
      const payload = parsePayload(encoded);
      if (!payload || payload.tenantId !== binding.tenantId ||
        payload.kind !== binding.kind) return { status: "invalid" };
      if (payload.expiresAt <= now()) return { status: "expired" };
      return { status: "valid", position: {
        updatedAt: payload.updatedAt, id: payload.id,
      } };
    },
  };
}

export function createEnvironmentEnterpriseContactDirectoryCursorService() {
  return createEnterpriseContactDirectoryCursorService({
    signingSecret: process.env.ENTERPRISE_CONTACT_CURSOR_SECRET?.trim(),
    ttlSeconds: environmentTtl(process.env.ENTERPRISE_CONTACT_CURSOR_TTL_SECONDS),
  });
}

interface CursorPayload {
  version: 1;
  tenantId: string;
  kind: EnterpriseContactDirectoryKind;
  updatedAt: string;
  id: string;
  expiresAt: number;
}

function parsePayload(encoded: string): CursorPayload | null {
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (value.version !== 1 || !uuid(value.tenantId) ||
      (value.kind !== "leads" && value.kind !== "customers") ||
      !iso(value.updatedAt) || !uuid(value.id) ||
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt < 1) return null;
    return value as unknown as CursorPayload;
  } catch {
    return null;
  }
}

function sign(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}
function sameSignature(supplied: string, expected: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(supplied)) return false;
  const left = Buffer.from(supplied, "base64url");
  const right = Buffer.from(expected, "base64url");
  return left.length === right.length && timingSafeEqual(left, right);
}
function validSecret(value: string | undefined): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32;
}
function validTtl(value: number) {
  return Number.isSafeInteger(value) && value >= 60 && value <= 3_600;
}
function environmentTtl(value: string | undefined) {
  if (value === undefined || value.trim() === "") return 900;
  return /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
}
function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function iso(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
