import { randomUUID } from "node:crypto";
import {
  getStoreSnapshot,
} from "../storage/json-store.js";
import {
  createEnterpriseAuditEvent,
} from "../../modules/enterprise/enterprise-audit.repository.js";
import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterpriseMemberRecord,
} from "../../modules/enterprise/enterprise-tenant-record.js";
import {
  listEnterprisePostgresMemberships,
  resolveEnterprisePostgresContext,
} from "./enterprise-postgres-directory.repository.js";
import type {
  EnterprisePostgresPool,
} from "./enterprise-postgres-client.js";
import {
  withEnterpriseTenantPostgresRepository,
} from "./enterprise-postgres-tenant.repository.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";
import {
  beginPostgresTenantCreation,
  beginPostgresTenantRetry,
  findPostgresTenantJob,
  startPostgresTenantLifecycleJob,
} from "./enterprise-postgres-runtime-lifecycle-start.js";
import {
  claimPostgresTenantLifecycleJob,
  finalizePostgresTenantLifecycleJob,
  finalizePostgresTenantProvision,
} from "./enterprise-postgres-runtime-lifecycle-process.js";

export function createPostgresEnterpriseRepositoryRuntime(
  pool: EnterprisePostgresPool,
): EnterpriseRepositoryRuntime {
  return {
    driver: "postgres",
    resolveContext(input) {
      return resolveEnterprisePostgresContext({
        pool,
        userId: input.userId,
        selectedTenantId: input.selectedTenantId,
        traceId: input.traceId,
      });
    },
    listMemberships(input) {
      return listEnterprisePostgresMemberships({
        pool,
        userId: input.userId,
        traceId: input.traceId,
      });
    },
    listMembers(context) {
      return withEnterpriseTenantPostgresRepository(
        pool,
        context,
        (repository) => repository.listMembers(),
      );
    },
    async addMember(input) {
      const account = getStoreSnapshot().accounts.find((item) =>
        item.id === input.userId && item.status === "active"
      );
      if (!account) return { status: "account_not_found" as const };
      const now = new Date().toISOString();
      const member: EnterpriseMemberRecord = {
        id: randomUUID(),
        tenantId: input.context.tenantId,
        userId: input.userId,
        role: input.role,
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const inserted = await unit.tenant.insertMember(member);
          if (inserted.status === "already_exists") {
            return {
              status: "already_exists" as const,
              member: await unit.tenant.findMemberByUserId(input.userId) ??
                undefined,
            };
          }
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "member.create",
            resourceType: "member",
            resourceId: inserted.member.id,
            result: "completed",
            details: {
              targetUserId: inserted.member.userId,
              role: inserted.member.role,
              status: inserted.member.status,
            },
            createdAt: now,
          }));
          return inserted;
        },
      );
    },
    updateMember(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const current = await unit.tenant.findMemberById(
            input.memberId,
            { lock: true },
          );
          if (!current) return { status: "not_found" as const };
          if (current.role === "owner") {
            return {
              status: "owner_protected" as const,
              member: current,
            };
          }
          const now = new Date().toISOString();
          const updated = await unit.tenant.updateMember({
            memberId: input.memberId,
            expectedVersion: current.version,
            role: input.role,
            status: input.status,
            updatedAt: now,
          });
          if (updated.status !== "updated") return updated;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "member.update",
            resourceType: "member",
            resourceId: updated.member.id,
            result: "completed",
            details: {
              targetUserId: updated.member.userId,
              role: updated.member.role,
              status: updated.member.status,
              version: updated.member.version,
            },
            createdAt: now,
          }));
          return updated;
        },
      );
    },
    async appendAudit(input) {
      await withEnterpriseTenantPostgresRepository(
        pool,
        input.context,
        (repository) =>
          repository.appendAuditEvent(createEnterpriseAuditEvent(input)),
      );
    },
    listAudit(input) {
      return withEnterpriseTenantPostgresRepository(
        pool,
        input.context,
        (repository) => repository.listAuditEvents(input),
      );
    },
    beginTenantCreation(input) {
      return beginPostgresTenantCreation(pool, input);
    },
    beginTenantRetry(input) {
      return beginPostgresTenantRetry(pool, input);
    },
    finalizeTenantProvision(input) {
      return finalizePostgresTenantProvision(pool, input);
    },
    startTenantLifecycleJob(input) {
      return startPostgresTenantLifecycleJob(pool, input);
    },
    findTenantJob(input) {
      return findPostgresTenantJob(pool, input);
    },
    claimTenantLifecycleJob(input) {
      return claimPostgresTenantLifecycleJob(pool, input);
    },
    finalizeTenantLifecycleJob(input) {
      return finalizePostgresTenantLifecycleJob(pool, input);
    },
    async pendingTenantLifecycleJobRefs() {
      return [];
    },
    async close() {
      await pool.end();
    },
  };
}
