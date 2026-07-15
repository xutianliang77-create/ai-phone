import type { FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { resolveEnterpriseContext } from "./enterprise-tenants.repository.js";

export function requireEnterpriseContext(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const account = requireAccount(request, reply);
  if (!account) return null;
  const selectedTenantId = headerValue(request.headers["x-tenant-id"]);
  const result = resolveEnterpriseContext(account.id, selectedTenantId);
  if (result.status === "access_denied") {
    sendError(reply, 403, "tenant_access_denied", "Tenant access denied");
    return null;
  }
  if (result.status === "selection_required") {
    sendError(reply, 400, "tenant_selection_required", "Tenant selection required");
    return null;
  }
  return { account, tenant: result.tenant, member: result.member };
}

export function canManageEnterpriseMembers(role: string) {
  return role === "owner" || role === "admin";
}

function headerValue(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}
