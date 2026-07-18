import type { FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  enterpriseRequestTraceId,
  requireEnterpriseScope,
} from "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { validateEnterpriseVersionWindow } from "./enterprise-terminology.js";

export async function requireEnterpriseContentAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "knowledge:read" | "knowledge:publish",
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action, resourceType: "terminology",
  });
  if (!access || !requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  )) return null;
  return access;
}

export function enterpriseContentContext(
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
  traceId: unknown,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id, actorUserId: access.account.id,
    actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(traceId),
  });
}

export function parseEnterprisePublication(value: unknown, now: string) {
  const body = objectValue(value);
  if (!body || !optionalTenant(body.tenantId) || !positiveInteger(body.expectedVersion) ||
    (body.effectiveFrom !== undefined && typeof body.effectiveFrom !== "string") ||
    (body.expiresAt !== undefined && typeof body.expiresAt !== "string")) return null;
  const result = {
    tenantId: body.tenantId as string | undefined,
    expectedVersion: Number(body.expectedVersion),
    effectiveFrom: body.effectiveFrom as string | undefined ?? now,
    ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt as string }),
    publishedAt: now,
  };
  try {
    validateEnterpriseVersionWindow(result);
    return result;
  } catch { return null; }
}

export function validateEnterpriseBodyTenant(
  reply: FastifyReply,
  value: unknown,
  tenantId: string,
) {
  return value === undefined || value === tenantId
    ? true
    : (contentError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch"), false);
}

export function objectValue(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function boundedText(value: unknown, maxBytes: number) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && Buffer.byteLength(result) <= maxBytes ? result : null;
}

export function uuidValue(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

export function optionalTenant(value: unknown) {
  return value === undefined || typeof value === "string";
}

export function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

export function contentError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message = "Invalid enterprise content request",
) {
  return sendError(reply, statusCode, code, message);
}

export function postgresContentRequired(reply: FastifyReply) {
  return contentError(
    reply, 503, "enterprise_postgres_required", "PostgreSQL enterprise runtime required",
  );
}

export function versionConflict(reply: FastifyReply, prefix: string, status: string) {
  if (status === "not_found") {
    return contentError(reply, 404, `${prefix}_not_found`, "Content version not found");
  }
  return contentError(reply, 409, `${prefix}_${status}`, "Content version conflict");
}
