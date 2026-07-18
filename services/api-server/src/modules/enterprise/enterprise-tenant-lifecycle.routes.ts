import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CreateEnterpriseTenantRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { enterpriseRequestTraceId } from "./enterprise-auth.js";
import type {
  EnterpriseMemberRecord,
  EnterpriseTenantJobRecord,
  EnterpriseTenantRecord,
} from "./enterprise-tenant-record.js";
import type { TenantProvisioner } from "./enterprise-tenant-provisioner.js";
import type {
  TenantLifecycleExecutor,
} from "./enterprise-tenant-lifecycle-executor.js";
import {
  enterpriseTenantLifecycleJobRef,
  processEnterpriseTenantLifecycleJob,
} from "./enterprise-tenant-lifecycle-processor.js";
import type {
  EnterpriseRepositoryRuntime,
} from "./enterprise-repository-runtime.js";

export async function registerEnterpriseTenantLifecycleRoutes(
  app: FastifyInstance,
  provisioner: TenantProvisioner,
  lifecycleExecutor: TenantLifecycleExecutor,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/saas/v1/tenants", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const idempotencyKey = requireIdempotencyKey(request, reply);
    if (!idempotencyKey) return;
    const body = (request.body ?? {}) as Partial<CreateEnterpriseTenantRequest>;
    const name = cleanText(body.name, 120);
    const homeRegion = regionValue(body.homeRegion);
    if (!name || name.length < 2 || !homeRegion) {
      return sendError(reply, 400, "invalid_tenant", "Invalid tenant");
    }
    const begun = await runtime.beginTenantCreation({
      ownerUserId: account.id,
      name,
      homeRegion,
      idempotencyKey,
      traceId: enterpriseRequestTraceId(request),
    });
    if (begun.status === "conflict") return idempotencyConflict(reply);
    if (begun.status !== "created") {
      return sendExistingProvision(reply, begun, 200);
    }
    if (!hasLifecycleRecords(begun)) return tenantNotFound(reply);
    const completed = await provisionTenant(
      runtime,
      provisioner,
      begun.tenant,
      begun.job,
    );
    return sendProvisionResult(reply, completed, 201);
  });

  app.post("/saas/v1/tenants/:tenantId/provision", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const idempotencyKey = requireIdempotencyKey(request, reply);
    if (!idempotencyKey) return;
    const { tenantId } = request.params as { tenantId: string };
    const begun = await runtime.beginTenantRetry({
      tenantId,
      actorUserId: account.id,
      idempotencyKey,
      traceId: enterpriseRequestTraceId(request),
    });
    if (begun.status === "conflict") return idempotencyConflict(reply);
    if (begun.status === "not_found") return tenantNotFound(reply);
    if (begun.status === "invalid_state") {
      return sendError(reply, 409, "tenant_state_conflict", "Tenant state conflict");
    }
    if (begun.status === "existing") return sendExistingProvision(reply, begun, 200);
    if (!hasLifecycleRecords(begun)) return tenantNotFound(reply);
    const completed = await provisionTenant(
      runtime,
      provisioner,
      begun.tenant,
      begun.job,
    );
    return sendProvisionResult(reply, completed, 200);
  });

  for (const action of ["suspend", "export", "delete"] as const) {
    app.post(`/saas/v1/tenants/:tenantId/${action}`, async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const idempotencyKey = requireIdempotencyKey(request, reply);
      if (!idempotencyKey) return;
      const { tenantId } = request.params as { tenantId: string };
      const started = await runtime.startTenantLifecycleJob({
        tenantId,
        actorUserId: account.id,
        type: `tenant.${action}`,
        idempotencyKey,
        traceId: enterpriseRequestTraceId(request),
      });
      if (started.status === "conflict") return idempotencyConflict(reply);
      if (started.status === "not_found") return tenantNotFound(reply);
      if (started.status === "invalid_state") {
        return sendError(reply, 409, "tenant_state_conflict", "Tenant state conflict");
      }
      if (started.status === "pending_jobs") {
        return sendError(
          reply,
          409,
          "tenant_lifecycle_pending",
          "Tenant lifecycle jobs are still processing",
        );
      }
      if (action === "suspend") {
        return sendLifecycleResult(reply, started);
      }
      if (!started.job) return tenantNotFound(reply);
      const processed = await processEnterpriseTenantLifecycleJob(
        enterpriseTenantLifecycleJobRef(started.job),
        lifecycleExecutor,
        { force: true, runtime },
      );
      return sendLifecycleResult(reply, processed);
    });
  }

  app.get("/saas/v1/tenant-jobs/:jobId", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const { jobId } = request.params as { jobId: string };
    const job = await runtime.findTenantJob({
      jobId,
      userId: account.id,
      traceId: enterpriseRequestTraceId(request),
    });
    if (!job) return sendError(reply, 404, "tenant_job_not_found", "Tenant job not found");
    return { job: toJobDto(job) };
  });
}

async function provisionTenant(
  runtime: EnterpriseRepositoryRuntime,
  provisioner: TenantProvisioner,
  tenant: EnterpriseTenantRecord,
  job: EnterpriseTenantJobRecord,
) {
  try {
    const result = await provisioner.provision({
      tenantId: tenant.id,
      homeRegion: tenant.homeRegion,
    });
    return runtime.finalizeTenantProvision({
      tenantId: tenant.id,
      actorUserId: job.actorUserId,
      jobId: job.id,
      result,
    });
  } catch {
    return runtime.finalizeTenantProvision({
      tenantId: tenant.id,
      actorUserId: job.actorUserId,
      jobId: job.id,
      result: {
        status: "not_ready",
        reason: "provisioner_unavailable",
      },
    });
  }
}

function sendExistingProvision(
  reply: FastifyReply,
  result: LifecycleResult,
  successStatus: number,
) {
  if (result.status !== "existing") return tenantNotFound(reply);
  return sendProvisionResult(reply, result, successStatus);
}

function sendProvisionResult(
  reply: FastifyReply,
  result: LifecycleResult,
  successStatus: number,
) {
  if (!hasLifecycleRecords(result)) return tenantNotFound(reply);
  const body = lifecycleDto(result);
  if (result.job.status === "failed") {
    return reply.status(503).send({
      ...body,
      error: {
        code: "tenant_provisioning_failed",
        message: "Tenant provisioning failed",
      },
    });
  }
  const statusCode = result.job.status === "processing" ? 202 : successStatus;
  return reply.status(statusCode).send(body);
}

function sendLifecycleResult(reply: FastifyReply, result: LifecycleResult) {
  if (!hasLifecycleRecords(result)) return tenantNotFound(reply);
  const body = lifecycleDto(result);
  if (result.job.status === "failed") {
    return reply.status(503).send({
      ...body,
      error: {
        code: "tenant_lifecycle_failed",
        message: "Tenant lifecycle job failed",
      },
    });
  }
  const statusCode = result.job.status === "processing" ? 202 : 200;
  return reply.status(statusCode).send(body);
}

type LifecycleResult = {
  status: string;
  tenant?: EnterpriseTenantRecord;
  member?: EnterpriseMemberRecord;
  job?: EnterpriseTenantJobRecord;
};

function hasLifecycleRecords(result: LifecycleResult): result is LifecycleResult & {
  tenant: EnterpriseTenantRecord;
  member: EnterpriseMemberRecord;
  job: EnterpriseTenantJobRecord;
} {
  return Boolean(result.tenant && result.member && result.job);
}

function lifecycleDto(result: {
  tenant: EnterpriseTenantRecord;
  member: EnterpriseMemberRecord;
  job: EnterpriseTenantJobRecord;
}) {
  return {
    tenant: toTenantDto(result.tenant),
    member: { ...result.member },
    job: toJobDto(result.job),
  };
}

function toTenantDto(tenant: EnterpriseTenantRecord) {
  const { billingCustomerRef: _billingCustomerRef, ...dto } = tenant;
  return dto;
}

function toJobDto(job: EnterpriseTenantJobRecord) {
  const {
    idempotencyKey: _idempotencyKey,
    requestHash: _requestHash,
    leaseExpiresAt: _leaseExpiresAt,
    nextAttemptAt: _nextAttemptAt,
    scopeSnapshot: _scopeSnapshot,
    ...dto
  } = job;
  return dto;
}

function requireIdempotencyKey(request: FastifyRequest, reply: FastifyReply) {
  const raw = request.headers["idempotency-key"];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) {
    sendError(reply, 400, "idempotency_key_required", "Idempotency key required");
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    sendError(reply, 400, "invalid_idempotency_key", "Invalid idempotency key");
    return null;
  }
  return value;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function regionValue(value: unknown) {
  const region = cleanText(value, 32).toLowerCase();
  return /^[a-z][a-z0-9-]{1,31}$/.test(region) ? region : null;
}

function idempotencyConflict(reply: FastifyReply) {
  return sendError(reply, 409, "idempotency_conflict", "Idempotency conflict");
}

function tenantNotFound(reply: FastifyReply) {
  return sendError(reply, 404, "tenant_not_found", "Tenant not found");
}
