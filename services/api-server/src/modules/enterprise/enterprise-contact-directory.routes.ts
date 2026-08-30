import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  EnterpriseCustomerDirectoryDetailResponse,
  EnterpriseCustomerDirectoryResponse,
  EnterpriseLeadDirectoryDetailResponse,
  EnterpriseLeadDirectoryResponse,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type {
  EnterpriseContactDirectoryCursorService,
} from "./enterprise-contact-directory-cursor.js";
import type { EnterpriseContactDirectoryKind } from
  "./enterprise-contact-directory.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";

interface DirectoryQuery { cursor?: string; limit?: string }

export function registerEnterpriseContactDirectoryRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  cursorService: EnterpriseContactDirectoryCursorService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.get("/enterprise/v1/leads", async (request, reply) => {
    const access = await authorized(request, reply, routeService, runtime,
      "campaign:read", "contact_directory.leads_list", "marketing_lead");
    if (!access) return;
    if (!cursorService.ready) return cursorNotConfigured(reply);
    if (runtime.driver !== "postgres" || !runtime.listEnterpriseLeads) {
      return postgresRequired(reply);
    }
    const query = parseQuery(request.query);
    if (!query) return invalidQuery(reply);
    const position = verifyCursor(cursorService, query.cursor,
      { tenantId: access.tenant.id, kind: "leads" }, reply);
    if (position === null) return;
    const result = await runtime.listEnterpriseLeads({
      context: context(request, access), limit: query.limit,
      ...(position ? { before: position } : {}),
      evaluatedAt: new Date().toISOString(),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    const nextCursor = issueCursor(cursorService, access.tenant.id, "leads",
      result.nextPosition, reply);
    if (nextCursor === null) return;
    const response: EnterpriseLeadDirectoryResponse = {
      leads: result.leads, ...(nextCursor ? { nextCursor } : {}),
    };
    return reply.send(response);
  });

  app.get<{ Params: { leadId: string } }>(
    "/enterprise/v1/leads/:leadId",
    async (request, reply) => {
      const leadId = uuid(request.params.leadId);
      if (!leadId) return invalidId(reply, "lead");
      const access = await authorized(request, reply, routeService, runtime,
        "campaign:read", "contact_directory.lead_read", "marketing_lead", leadId);
      if (!access) return;
      if (!cursorService.ready) return cursorNotConfigured(reply);
      if (runtime.driver !== "postgres" || !runtime.getEnterpriseLead) {
        return postgresRequired(reply);
      }
      const result = await runtime.getEnterpriseLead({
        context: context(request, access), leadId,
        evaluatedAt: new Date().toISOString(),
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply, "lead");
      const response: EnterpriseLeadDirectoryDetailResponse = {
        lead: result.lead,
      };
      return reply.send(response);
    },
  );

  app.get("/enterprise/v1/customers", async (request, reply) => {
    const access = await authorized(request, reply, routeService, runtime,
      "support:read", "contact_directory.customers_list", "customer_profile");
    if (!access) return;
    if (!cursorService.ready) return cursorNotConfigured(reply);
    if (runtime.driver !== "postgres" || !runtime.listEnterpriseCustomers) {
      return postgresRequired(reply);
    }
    const query = parseQuery(request.query);
    if (!query) return invalidQuery(reply);
    const position = verifyCursor(cursorService, query.cursor,
      { tenantId: access.tenant.id, kind: "customers" }, reply);
    if (position === null) return;
    const result = await runtime.listEnterpriseCustomers({
      context: context(request, access), limit: query.limit,
      ...(position ? { before: position } : {}),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    const nextCursor = issueCursor(cursorService, access.tenant.id, "customers",
      result.nextPosition, reply);
    if (nextCursor === null) return;
    const response: EnterpriseCustomerDirectoryResponse = {
      customers: result.customers, ...(nextCursor ? { nextCursor } : {}),
    };
    return reply.send(response);
  });

  app.get<{ Params: { customerId: string } }>(
    "/enterprise/v1/customers/:customerId",
    async (request, reply) => {
      const customerId = uuid(request.params.customerId);
      if (!customerId) return invalidId(reply, "customer");
      const access = await authorized(request, reply, routeService, runtime,
        "support:read", "contact_directory.customer_read", "customer_profile",
        customerId);
      if (!access) return;
      if (!cursorService.ready) return cursorNotConfigured(reply);
      if (runtime.driver !== "postgres" || !runtime.getEnterpriseCustomer) {
        return postgresRequired(reply);
      }
      const result = await runtime.getEnterpriseCustomer({
        context: context(request, access), customerId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return notFound(reply, "customer");
      const response: EnterpriseCustomerDirectoryDetailResponse = {
        customer: result.customer, recentSessions: result.recentSessions,
        recentCases: result.recentCases,
      };
      return reply.send(response);
    },
  );
}

async function authorized(request: FastifyRequest, reply: FastifyReply,
  routeService: TenantRouteService, runtime: EnterpriseRepositoryRuntime,
  scope: "campaign:read" | "support:read", action: string,
  resourceType: "marketing_lead" | "customer_profile", resourceId?: string) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType, ...(resourceId ? { resourceId } : {}) });
  return access && requireTenantRouteDocument(request, reply, routeService,
    access.tenant) ? access : null;
}

function context(request: FastifyRequest,
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>) {
  return createEnterpriseTenantContext({ tenantId: access.tenant.id,
    actorUserId: access.account.id, actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request) });
}

function parseQuery(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const query = value as Record<string, unknown>;
  if (Object.keys(query).some((key) => key !== "cursor" && key !== "limit"))
    return null;
  const cursor = query.cursor === undefined ? undefined
    : typeof query.cursor === "string" && query.cursor.length >= 1 &&
        query.cursor.length <= 2_048
      ? query.cursor : null;
  const limit = query.limit === undefined ? 50
    : typeof query.limit === "string" && /^[1-9][0-9]{0,2}$/.test(query.limit)
      ? Number(query.limit) : null;
  return cursor !== null && limit !== null && limit <= 100
    ? { cursor, limit } : null;
}

function verifyCursor(service: EnterpriseContactDirectoryCursorService,
  cursor: string | undefined, binding: { tenantId: string;
    kind: EnterpriseContactDirectoryKind }, reply: FastifyReply) {
  if (!cursor) return undefined;
  const result = service.verify(cursor, binding);
  if (result.status === "valid") return result.position;
  if (result.status === "not_ready") cursorNotConfigured(reply);
  else sendError(reply, 400, result.status === "expired"
    ? "contact_cursor_expired" : "contact_cursor_invalid",
  "Contact directory cursor rejected");
  return null;
}

function issueCursor(service: EnterpriseContactDirectoryCursorService,
  tenantId: string, kind: EnterpriseContactDirectoryKind,
  position: { updatedAt: string; id: string } | undefined, reply: FastifyReply) {
  if (!position) return undefined;
  const result = service.issue({ tenantId, kind }, position);
  if (result.status === "ready") return result.cursor;
  cursorNotConfigured(reply);
  return null;
}

function uuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value) ? value : null;
}
function invalidQuery(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_contact_directory_query", "Invalid contact directory query"); }
function invalidId(reply: FastifyReply, kind: "lead" | "customer") {
  return sendError(reply, 400, `invalid_${kind}_id`, `Invalid ${kind} id`); }
function notFound(reply: FastifyReply, kind: "lead" | "customer") {
  return sendError(reply, 404, `${kind}_not_found`, `${kind} not found`); }
function cursorNotConfigured(reply: FastifyReply) { return sendError(reply, 503,
  "contact_cursor_not_configured", "Contact directory cursor is not configured"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
