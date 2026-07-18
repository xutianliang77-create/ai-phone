import type { FastifyInstance } from "fastify";
import type {
  CreateEnterpriseMemberRequest,
  UpdateEnterpriseMemberRequest,
} from "@translation/contracts";
import {
  isEnterpriseMemberRole,
  isEnterpriseMemberStatus,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { requireEnterpriseScope } from "./enterprise-auth.js";
import { enterpriseScopesForRole } from "./enterprise-rbac.js";
import { registerEnterpriseTenantLifecycleRoutes } from "./enterprise-tenant-lifecycle.routes.js";
import type { TenantProvisioner } from "./enterprise-tenant-provisioner.js";
import type {
  TenantLifecycleExecutor,
} from "./enterprise-tenant-lifecycle-executor.js";
import {
  registerEnterpriseTenantRouteRoutes,
  requireTenantRouteDocument,
} from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";
import {
  createEnterpriseTenantContext,
} from "./enterprise-tenant-context.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";

export async function registerEnterpriseTenantRoutes(
  app: FastifyInstance,
  tenantProvisioner: TenantProvisioner,
  tenantRouteService: TenantRouteService,
  tenantLifecycleExecutor: TenantLifecycleExecutor,
  runtime: EnterpriseRepositoryRuntime,
) {
  await registerEnterpriseTenantLifecycleRoutes(
    app,
    tenantProvisioner,
    tenantLifecycleExecutor,
    runtime,
  );
  await registerEnterpriseTenantRouteRoutes(app, tenantRouteService, runtime);

  app.get("/enterprise/v1/me", async (request, reply) => {
    const context = await requireEnterpriseScope(
      request,
      reply,
      runtime,
      "tenant:read",
    );
    if (!context) return;
    return {
      tenant: toTenantDto(context.tenant),
      member: toMemberDto(context.member),
      scopes: enterpriseScopesForRole(context.member.role),
    };
  });

  app.get("/enterprise/v1/tenants", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return {
      tenants: (await runtime.listMemberships({
        userId: account.id,
        traceId: String(request.id),
      })).map(({ tenant, member }) => ({
        tenant: toTenantDto(tenant),
        member: toMemberDto(member),
      })),
    };
  });

  app.get("/enterprise/v1/members", async (request, reply) => {
    const context = await requireEnterpriseScope(
      request,
      reply,
      runtime,
      "member:read",
    );
    if (!context) return;
    const repositoryContext = createEnterpriseTenantContext({
      tenantId: context.tenant.id,
      actorUserId: context.account.id,
      actorRole: context.member.role,
      traceId: String(request.id),
    });
    return {
      members: (await runtime.listMembers(repositoryContext)).map(toMemberDto),
    };
  });

  app.post("/enterprise/v1/members", async (request, reply) => {
    const context = await requireEnterpriseScope(
      request,
      reply,
      runtime,
      "member:write",
      {
        action: "member.create",
        resourceType: "member",
      },
    );
    if (!context) return;
    if (!requireTenantRouteDocument(
      request,
      reply,
      tenantRouteService,
      context.tenant,
    )) return;
    const body = (request.body ?? {}) as Partial<CreateEnterpriseMemberRequest>;
    if (tenantMismatch(body.tenantId, context.tenant.id)) {
      return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
    }
    const userId = cleanText(body.userId, 120);
    if (!userId || !isEnterpriseMemberRole(body.role) || body.role === "owner") {
      return sendError(reply, 400, "invalid_member", "Invalid member");
    }
    const result = await runtime.addMember({
      context: createEnterpriseTenantContext({
        tenantId: context.tenant.id,
        actorUserId: context.account.id,
        actorRole: context.member.role,
        traceId: String(request.id),
      }),
      userId,
      role: body.role,
    });
    if (result.status === "account_not_found") {
      return sendError(reply, 404, "account_not_found", "Account not found");
    }
    if (result.status === "already_exists") {
      return sendError(reply, 409, "member_already_exists", "Member already exists");
    }
    return reply.status(201).send({ member: toMemberDto(result.member) });
  });

  app.patch("/enterprise/v1/members/:memberId", async (request, reply) => {
    const params = request.params as { memberId: string };
    const context = await requireEnterpriseScope(
      request,
      reply,
      runtime,
      "member:write",
      {
        action: "member.update",
        resourceType: "member",
        resourceId: params.memberId,
      },
    );
    if (!context) return;
    if (!requireTenantRouteDocument(
      request,
      reply,
      tenantRouteService,
      context.tenant,
    )) return;
    const body = (request.body ?? {}) as Partial<UpdateEnterpriseMemberRequest>;
    if (tenantMismatch(body.tenantId, context.tenant.id)) {
      return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
    }
    const role = body.role === undefined ? undefined : body.role;
    const status = body.status === undefined ? undefined : body.status;
    if ((!role && !status) || (role !== undefined &&
      (!isEnterpriseMemberRole(role) || role === "owner")) ||
      (status !== undefined && !isEnterpriseMemberStatus(status))) {
      return sendError(reply, 400, "invalid_member_update", "Invalid member update");
    }
    const result = await runtime.updateMember({
      context: createEnterpriseTenantContext({
        tenantId: context.tenant.id,
        actorUserId: context.account.id,
        actorRole: context.member.role,
        traceId: String(request.id),
      }),
      memberId: params.memberId,
      role,
      status,
    });
    if (result.status === "not_found") {
      return sendError(reply, 404, "member_not_found", "Member not found");
    }
    if (result.status === "owner_protected") {
      return sendError(reply, 409, "owner_member_protected", "Owner member is protected");
    }
    if (result.status === "conflict") {
      return sendError(reply, 409, "member_version_conflict", "Member version conflict");
    }
    return { member: toMemberDto(result.member) };
  });
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function tenantMismatch(value: unknown, tenantId: string) {
  return value !== undefined && value !== tenantId;
}

function toTenantDto(tenant: EnterpriseTenantRecord) {
  const { billingCustomerRef: _billingCustomerRef, ...dto } = tenant;
  return dto;
}

function toMemberDto(member: EnterpriseMemberRecord) {
  return { ...member };
}
