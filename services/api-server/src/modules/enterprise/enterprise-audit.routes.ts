import type { FastifyInstance } from "fastify";
import {
  isEnterpriseAuditResult,
  type EnterpriseAuditResult,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import {
  listEnterpriseAuditEvents,
} from "./enterprise-audit.repository.js";
import type {
  EnterpriseAuditCursorBinding,
  EnterpriseAuditCursorService,
} from "./enterprise-audit-cursor.js";
import { requireEnterpriseScope } from "./enterprise-auth.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";

interface AuditQuery {
  action?: string;
  resourceType?: string;
  result?: string;
  limit?: string;
  cursor?: string;
}

export async function registerEnterpriseAuditRoutes(
  app: FastifyInstance,
  cursorService: EnterpriseAuditCursorService,
) {
  app.get("/enterprise/v1/audit-events", async (request, reply) => {
    const context = requireEnterpriseScope(request, reply, "audit:read", {
      action: "audit.read",
      resourceType: "audit_event",
    });
    if (!context) return;
    if (!cursorService.ready) {
      return sendError(
        reply,
        503,
        "audit_cursor_not_configured",
        "Audit cursor signing is not configured",
      );
    }
    const parsed = parseQuery(request.query as AuditQuery);
    if (parsed.status === "invalid") {
      return sendError(reply, 400, "invalid_audit_query", "Invalid audit query");
    }
    const binding: EnterpriseAuditCursorBinding = {
      tenantId: context.tenant.id,
      action: parsed.action,
      resourceType: parsed.resourceType,
      result: parsed.result,
    };
    const repositoryContext = createEnterpriseTenantContext({
      tenantId: context.tenant.id,
      actorUserId: context.account.id,
      actorRole: context.member.role,
      traceId: String(request.id),
    });
    let before;
    if (parsed.cursor) {
      const verified = cursorService.verify(parsed.cursor, binding);
      if (verified.status !== "valid") {
        return sendError(
          reply,
          400,
          verified.status === "expired"
            ? "expired_audit_cursor"
            : "invalid_audit_cursor",
          "Invalid audit cursor",
        );
      }
      before = verified.position;
    }
    const listed = listEnterpriseAuditEvents({
      context: repositoryContext,
      limit: parsed.limit,
      action: parsed.action,
      resourceType: parsed.resourceType,
      result: parsed.result,
      before,
    });
    const issued = listed.nextPosition
      ? cursorService.issue(binding, listed.nextPosition)
      : undefined;
    if (issued?.status === "not_ready") {
      return sendError(
        reply,
        503,
        "audit_cursor_not_configured",
        "Audit cursor signing is not configured",
      );
    }
    return {
      events: listed.events,
      nextCursor: issued?.cursor,
    };
  });
}

function parseQuery(query: AuditQuery) {
  const action = optionalIdentifier(query.action);
  const resourceType = optionalIdentifier(query.resourceType);
  const result = optionalResult(query.result);
  const limit = limitValue(query.limit);
  const cursor = optionalCursor(query.cursor);
  if (
    action === null ||
    resourceType === null ||
    result === null ||
    limit === null ||
    cursor === null
  ) return { status: "invalid" as const };
  return {
    status: "valid" as const,
    action,
    resourceType,
    result,
    limit,
    cursor,
  };
}

function optionalIdentifier(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-z][a-z0-9._:-]{0,79}$/.test(value)) {
    return null;
  }
  return value;
}

function optionalResult(value: unknown): EnterpriseAuditResult | undefined | null {
  if (value === undefined) return undefined;
  return isEnterpriseAuditResult(value) ? value : null;
}

function limitValue(value: unknown) {
  if (value === undefined) return 50;
  if (typeof value !== "string" || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const parsed = Number(value);
  return parsed <= 100 ? parsed : null;
}

function optionalCursor(value: unknown) {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= 2_048 ? value : null;
}
