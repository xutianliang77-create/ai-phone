import type { FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseScope } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { hasEnterpriseScope } from "./enterprise-rbac.js";
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

export function requireEnterpriseScope(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: EnterpriseScope,
) {
  const context = requireEnterpriseContext(request, reply);
  if (!context) return null;
  if (!hasEnterpriseScope(context.member.role, scope)) {
    sendError(reply, 403, "enterprise_scope_denied", "Enterprise scope denied");
    return null;
  }
  return context;
}

function headerValue(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}
