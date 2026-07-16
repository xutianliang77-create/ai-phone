import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { EnterpriseAuditResult } from "@translation/contracts";
import type {
  EnterpriseAuditPosition,
} from "./enterprise-audit.repository.js";

export interface EnterpriseAuditCursorBinding {
  tenantId: string;
  action?: string;
  resourceType?: string;
  result?: EnterpriseAuditResult;
}

export interface EnterpriseAuditCursorService {
  ready: boolean;
  issue(
    binding: EnterpriseAuditCursorBinding,
    position: EnterpriseAuditPosition,
  ): { status: "ready"; cursor: string } | { status: "not_ready" };
  verify(
    cursor: string,
    binding: EnterpriseAuditCursorBinding,
  ): { status: "valid"; position: EnterpriseAuditPosition } |
    { status: "invalid" | "expired" | "not_ready" };
}

export function createEnterpriseAuditCursorService(options: {
  signingSecret?: string;
  ttlSeconds?: number;
  now?: () => Date;
}): EnterpriseAuditCursorService {
  const secret = validSecret(options.signingSecret)
    ? options.signingSecret
    : undefined;
  const ttlSeconds = Math.min(3_600, Math.max(60, options.ttlSeconds ?? 900));
  const now = options.now ?? (() => new Date());
  return {
    ready: Boolean(secret),
    issue(binding, position) {
      if (!secret) return { status: "not_ready" };
      const payload = {
        version: 1,
        tenantId: binding.tenantId,
        filterHash: filterHash(binding),
        createdAt: position.createdAt,
        id: position.id,
        expiresAt: now().getTime() + ttlSeconds * 1_000,
      };
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return {
        status: "ready",
        cursor: `${encoded}.${signature(encoded, secret)}`,
      };
    },
    verify(cursor, binding) {
      if (!secret) return { status: "not_ready" };
      const [encoded, supplied, extra] = cursor.split(".");
      if (!encoded || !supplied || extra) return { status: "invalid" };
      const expected = signature(encoded, secret);
      if (!sameSignature(supplied, expected)) return { status: "invalid" };
      const payload = parsePayload(encoded);
      if (
        !payload ||
        payload.version !== 1 ||
        payload.tenantId !== binding.tenantId ||
        payload.filterHash !== filterHash(binding)
      ) return { status: "invalid" };
      if (payload.expiresAt <= now().getTime()) return { status: "expired" };
      return {
        status: "valid",
        position: { createdAt: payload.createdAt, id: payload.id },
      };
    },
  };
}

export function createEnvironmentEnterpriseAuditCursorService() {
  return createEnterpriseAuditCursorService({
    signingSecret: process.env.ENTERPRISE_AUDIT_CURSOR_SECRET,
    ttlSeconds: numberValue(process.env.ENTERPRISE_AUDIT_CURSOR_TTL_SECONDS),
  });
}

function filterHash(binding: EnterpriseAuditCursorBinding) {
  return createHash("sha256").update(JSON.stringify({
    tenantId: binding.tenantId,
    action: binding.action ?? null,
    resourceType: binding.resourceType ?? null,
    result: binding.result ?? null,
  })).digest("hex");
}

function signature(encoded: string, secret: string) {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

function sameSignature(supplied: string, expected: string) {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parsePayload(encoded: string) {
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    if (
      typeof value.version !== "number" ||
      typeof value.tenantId !== "string" ||
      typeof value.filterHash !== "string" ||
      typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      typeof value.id !== "string" ||
      !value.id ||
      typeof value.expiresAt !== "number"
    ) return null;
    return value as {
      version: number;
      tenantId: string;
      filterHash: string;
      createdAt: string;
      id: string;
      expiresAt: number;
    };
  } catch {
    return null;
  }
}

function validSecret(value: string | undefined): value is string {
  return Boolean(value && Buffer.byteLength(value) >= 32);
}

function numberValue(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
