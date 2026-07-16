import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import type { EnterpriseTenantRecord } from "./enterprise-tenant-record.js";
import {
  decodeTenantRouteDocument,
  type TenantRouteService,
} from "./enterprise-tenant-route.js";
import { resolveEnterpriseContext } from "./enterprise-tenants.repository.js";

export async function registerEnterpriseTenantRouteRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
) {
  app.get("/saas/v1/tenants/:tenantId/route", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const { tenantId } = request.params as { tenantId: string };
    const context = resolveEnterpriseContext(account.id, tenantId);
    if (context.status !== "resolved") {
      return sendError(reply, 404, "tenant_route_not_found", "Tenant route not found");
    }
    if (!context.tenant.cellId) {
      return sendError(reply, 503, "route_not_ready", "Tenant route not ready");
    }
    const result = routeService.issue({
      tenantId: context.tenant.id,
      homeRegion: context.tenant.homeRegion,
      cellId: context.tenant.cellId,
    });
    if (result.status === "not_ready") {
      return sendError(reply, 503, "route_not_ready", "Tenant route not ready");
    }
    return result.document;
  });
}

export function requireTenantRouteDocument(
  request: FastifyRequest,
  reply: FastifyReply,
  routeService: TenantRouteService,
  tenant: EnterpriseTenantRecord,
) {
  const raw = request.headers["x-enterprise-route-document"];
  const encoded = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!encoded) {
    sendError(reply, 428, "route_document_required", "Route document required");
    return false;
  }
  const document = decodeTenantRouteDocument(encoded);
  const result = routeService.verify(document, {
    tenantId: tenant.id,
    homeRegion: tenant.homeRegion,
    cellId: tenant.cellId ?? "",
  });
  if (result.status === "verified") return true;
  if (result.status === "not_ready") {
    sendError(reply, 503, "route_not_ready", "Tenant route not ready");
    return false;
  }
  const code = result.status === "expired"
    ? "route_document_expired"
    : result.status === "mismatch"
    ? "route_mismatch"
    : "route_document_invalid";
  sendError(reply, 409, code, "Tenant route rejected");
  return false;
}
