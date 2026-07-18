import type { FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseScope } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { hasEnterpriseScope } from "./enterprise-rbac.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";

export async function requireEnterpriseContext(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
) {
  const account = await requireAccount(request, reply);
  if (!account) return null;
  const selectedTenantId = headerValue(request.headers["x-tenant-id"]);
  const result = await runtime.resolveContext({
    userId: account.id,
    selectedTenantId,
    traceId: String(request.id),
  });
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

export async function requireEnterpriseScope(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  scope: EnterpriseScope,
  audit?: {
    action: string;
    resourceType: string;
    resourceId?: string;
  },
) {
  const context = await requireEnterpriseContext(request, reply, runtime);
  if (!context) return null;
  if (!hasEnterpriseScope(context.member.role, scope)) {
    if (audit) {
      await runtime.appendAudit({
        context: createEnterpriseTenantContext({
          tenantId: context.tenant.id,
          actorUserId: context.account.id,
          actorRole: context.member.role,
          traceId: String(request.id),
        }),
        action: audit.action,
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        result: "denied",
        details: {
          reasonCode: "enterprise_scope_denied",
          scope,
        },
      });
    }
    sendError(reply, 403, "enterprise_scope_denied", "Enterprise scope denied");
    return null;
  }
  return context;
}

function headerValue(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate?.trim() || undefined;
}
