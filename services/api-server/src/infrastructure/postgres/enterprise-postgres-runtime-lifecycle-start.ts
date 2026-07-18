import type {
  EnterpriseTenantJobType,
} from "@translation/contracts";
import {
  allowsLifecycleAction,
  hashRequest,
} from "../../modules/enterprise/enterprise-tenant-lifecycle-values.js";
import {
  createEnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import type {
  EnterpriseLifecycleResult,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterprisePostgresPool,
} from "./enterprise-postgres-client.js";
import {
  listEnterprisePostgresMemberships,
} from "./enterprise-postgres-directory.repository.js";
import {
  withEnterpriseLifecyclePostgresRepository,
} from "./enterprise-postgres-lifecycle.repository.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import {
  deterministicProvisionTenantId,
  lifecycleAuditEvent,
  lifecycleDeniedAuditEvent,
  lifecycleJob,
  lifecycleSnapshot,
  managerMember,
  provisionRecords,
} from "./enterprise-postgres-runtime-lifecycle-records.js";

export async function beginPostgresTenantCreation(
  pool: EnterprisePostgresPool,
  input: {
    ownerUserId: string;
    name: string;
    homeRegion: string;
    idempotencyKey: string;
    traceId: string;
  },
): Promise<EnterpriseLifecycleResult> {
  const tenantId = deterministicProvisionTenantId(
    input.ownerUserId,
    input.idempotencyKey,
  );
  const requestHash = hashRequest([input.name, input.homeRegion]);
  const now = new Date().toISOString();
  const records = provisionRecords({
    tenantId,
    ownerUserId: input.ownerUserId,
    name: input.name,
    homeRegion: input.homeRegion,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    now,
  });
  return withEnterprisePostgresUnitOfWork(
    pool,
    createEnterpriseTenantContext({
      tenantId,
      actorUserId: input.ownerUserId,
      traceId: input.traceId,
    }),
    async (unit) => {
      const inserted = await unit.tenant.insertTenant(records.tenant);
      if (inserted.status === "already_exists") {
        return existingResult(
          unit,
          "tenant.provision",
          input.idempotencyKey,
          requestHash,
          input.ownerUserId,
        );
      }
      await unit.billingEntitlements.ensureAccount({
        billingContactUserId: input.ownerUserId,
        now: new Date(now),
      });
      const member = await unit.tenant.insertMember(records.member);
      const job = await unit.lifecycle.insertJob(records.job);
      if (member.status !== "created" || job.status !== "created") {
        throw new Error("Enterprise PostgreSQL provision records conflict");
      }
      await unit.tenant.appendAuditEvent(
        lifecycleAuditEvent(job.job, "accepted", input.traceId, now),
      );
      return {
        status: "created",
        tenant: inserted.tenant,
        member: member.member,
        job: job.job,
      };
    },
  );
}

export function beginPostgresTenantRetry(
  pool: EnterprisePostgresPool,
  input: {
    tenantId: string;
    actorUserId: string;
    idempotencyKey: string;
    traceId: string;
  },
): Promise<EnterpriseLifecycleResult> {
  const requestHash = hashRequest([input.tenantId]);
  return withEnterprisePostgresUnitOfWork(
    pool,
    createEnterpriseTenantContext({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      traceId: input.traceId,
    }),
    async (unit) => {
      const tenant = await unit.tenant.findTenant({ lock: true });
      if (!tenant) return { status: "not_found" };
      const existing = await unit.lifecycle.findJobByIdempotency(
        "tenant.provision",
        input.idempotencyKey,
      );
      if (existing) {
        return lifecycleRecords(
          tenant,
          await unit.tenant.findMemberByUserId(input.actorUserId),
          existing,
          requestHash,
        );
      }
      const member = managerMember(
        await unit.tenant.findMemberByUserId(input.actorUserId),
      );
      if (!member) {
        await unit.tenant.appendAuditEvent(lifecycleDeniedAuditEvent({
          tenantId: input.tenantId,
          actorUserId: input.actorUserId,
          type: "tenant.provision",
          traceId: input.traceId,
        }));
        return { status: "not_found" };
      }
      if (tenant.status !== "provisioning_failed") {
        return { status: "invalid_state", tenant };
      }
      const now = new Date().toISOString();
      const updatedTenant = await unit.lifecycle.updateTenantStatus({
        status: "provisioning",
        expectedVersion: tenant.version,
        updatedAt: now,
      });
      if (updatedTenant.status !== "updated") {
        throw new Error("Enterprise PostgreSQL tenant retry conflict");
      }
      const job = lifecycleJob({
        tenantId: tenant.id,
        actorUserId: input.actorUserId,
        type: "tenant.provision",
        idempotencyKey: input.idempotencyKey,
        requestHash,
        now,
      });
      const inserted = await unit.lifecycle.insertJob(job);
      if (inserted.status !== "created") {
        throw new Error("Enterprise PostgreSQL tenant retry job conflict");
      }
      await unit.tenant.appendAuditEvent(
        lifecycleAuditEvent(inserted.job, "accepted", input.traceId, now),
      );
      return {
        status: "created",
        tenant: updatedTenant.tenant,
        member,
        job: inserted.job,
      };
    },
  );
}

export function startPostgresTenantLifecycleJob(
  pool: EnterprisePostgresPool,
  input: {
    tenantId: string;
    actorUserId: string;
    type: Exclude<EnterpriseTenantJobType, "tenant.provision">;
    idempotencyKey: string;
    traceId: string;
  },
): Promise<EnterpriseLifecycleResult> {
  const requestHash = hashRequest([input.tenantId, input.type]);
  return withEnterprisePostgresUnitOfWork(
    pool,
    createEnterpriseTenantContext({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      traceId: input.traceId,
    }),
    async (unit) => {
      let tenant = await unit.tenant.findTenant({ lock: true });
      if (!tenant || tenant.status === "deleted") return { status: "not_found" };
      const existing = await unit.lifecycle.findJobByIdempotency(
        input.type,
        input.idempotencyKey,
      );
      if (existing) {
        return lifecycleRecords(
          tenant,
          await unit.tenant.findMemberByUserId(input.actorUserId),
          existing,
          requestHash,
        );
      }
      const member = managerMember(
        await unit.tenant.findMemberByUserId(input.actorUserId),
      );
      if (!member) {
        await unit.tenant.appendAuditEvent(lifecycleDeniedAuditEvent({
          tenantId: tenant.id,
          actorUserId: input.actorUserId,
          type: input.type,
          traceId: input.traceId,
        }));
        return { status: "not_found" };
      }
      if (!allowsLifecycleAction(tenant)) {
        return { status: "invalid_state", tenant };
      }
      if (
        input.type === "tenant.delete" &&
        await unit.lifecycle.hasProcessingJob("tenant.export")
      ) {
        return { status: "pending_jobs", tenant };
      }
      const now = new Date().toISOString();
      const job = lifecycleJob({
        tenantId: tenant.id,
        actorUserId: input.actorUserId,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        now,
      });
      if (input.type === "tenant.suspend" || input.type === "tenant.delete") {
        const updated = await unit.lifecycle.updateTenantStatus({
          status: input.type === "tenant.suspend"
            ? "suspended"
            : "deletion_requested",
          expectedVersion: tenant.version,
          updatedAt: now,
        });
        if (updated.status !== "updated") {
          throw new Error("Enterprise PostgreSQL lifecycle tenant conflict");
        }
        tenant = updated.tenant;
      }
      if (input.type === "tenant.suspend") {
        job.status = "completed";
        job.completedAt = now;
      } else {
        job.scopeSnapshot = lifecycleSnapshot({
          tenant,
          member,
          members: await unit.tenant.listMembers(),
          jobs: await unit.lifecycle.listJobs(),
          newJob: job,
          now,
        });
      }
      const inserted = await unit.lifecycle.insertJob(job);
      if (inserted.status !== "created") {
        throw new Error("Enterprise PostgreSQL lifecycle job conflict");
      }
      await unit.tenant.appendAuditEvent(lifecycleAuditEvent(
        inserted.job,
        inserted.job.status === "completed" ? "completed" : "accepted",
        input.traceId,
        now,
      ));
      return { status: "created", tenant, member, job: inserted.job };
    },
  );
}

export async function findPostgresTenantJob(
  pool: EnterprisePostgresPool,
  input: { jobId: string; userId: string; traceId: string },
) {
  const memberships = await listEnterprisePostgresMemberships({
    pool,
    userId: input.userId,
    traceId: input.traceId,
    includeInactiveTenants: true,
  });
  for (const { tenant, member } of memberships) {
    const job = await withEnterpriseLifecyclePostgresRepository(
      pool,
      createEnterpriseTenantContext({
        tenantId: tenant.id,
        actorUserId: input.userId,
        actorRole: member.role,
        traceId: input.traceId,
      }),
      (repository) => repository.findJob(input.jobId),
    );
    if (
      job &&
      (job.actorUserId === input.userId ||
        member.role === "owner" ||
        member.role === "admin")
    ) return job;
  }
  return null;
}

async function existingResult(
  unit: Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0],
  type: EnterpriseTenantJobType,
  idempotencyKey: string,
  requestHash: string,
  actorUserId: string,
): Promise<EnterpriseLifecycleResult> {
  const tenant = await unit.tenant.findTenant();
  const member = await unit.tenant.findMemberByUserId(actorUserId);
  const job = await unit.lifecycle.findJobByIdempotency(type, idempotencyKey);
  if (!tenant || !member || !job) {
    throw new Error("Enterprise PostgreSQL idempotency records are incomplete");
  }
  return lifecycleRecords(tenant, member, job, requestHash);
}

function lifecycleRecords(
  tenant: import("../../modules/enterprise/enterprise-tenant-record.js").EnterpriseTenantRecord,
  member: import("../../modules/enterprise/enterprise-tenant-record.js").EnterpriseMemberRecord | null,
  job: import("../../modules/enterprise/enterprise-tenant-record.js").EnterpriseTenantJobRecord,
  requestHash: string,
): EnterpriseLifecycleResult {
  if (job.requestHash !== requestHash) return { status: "conflict" };
  return member
    ? { status: "existing", tenant, member, job }
    : { status: "not_found" };
}
