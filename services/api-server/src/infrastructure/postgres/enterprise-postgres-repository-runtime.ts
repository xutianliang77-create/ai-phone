import { randomUUID } from "node:crypto";
import { getStoreSnapshot } from "../storage/json-store.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import type { EnterpriseMemberRecord } from
  "../../modules/enterprise/enterprise-tenant-record.js";
import {
  listEnterprisePostgresMemberships,
  resolveEnterprisePostgresContext,
} from "./enterprise-postgres-directory.repository.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import { withEnterpriseTenantPostgresRepository } from "./enterprise-postgres-tenant.repository.js";
import { withEnterprisePostgresUnitOfWork } from "./enterprise-postgres-unit-of-work.js";
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
import { createEnterprisePostgresKnowledgeRuntime } from "./enterprise-postgres-knowledge-runtime.js";
import { createEnterprisePostgresTerminologyRuntime } from "./enterprise-postgres-terminology-runtime.js";
import { createEnterprisePostgresObservabilityRuntime } from "./enterprise-postgres-observability-runtime.js";
import { createEnterprisePostgresAuditExportRuntime } from "./enterprise-postgres-audit-export-runtime.js";
import { createEnterprisePostgresMeetingRuntime } from "./enterprise-postgres-meeting-runtime.js";
import { createEnterprisePostgresMeetingTranslationRuntime } from "./enterprise-postgres-meeting-translation-runtime.js";
import { createEnterprisePostgresMeetingScreenShareRuntime } from "./enterprise-postgres-meeting-screen-share-runtime.js";
import { createEnterprisePostgresMeetingMaterialRuntime } from "./enterprise-postgres-meeting-material-runtime.js";
import { createEnterprisePostgresBusinessRuntimes } from "./enterprise-postgres-business-runtimes.js"; import { createEnterprisePostgresBillingLifecycleRuntime } from "./enterprise-postgres-billing-lifecycle-runtime.js";
export function createPostgresEnterpriseRepositoryRuntime(
  pools: EnterprisePostgresPool | {
    tenantPool: EnterprisePostgresPool;
    directoryPool: EnterprisePostgresPool;
    close: () => Promise<void>;
  },
): EnterpriseRepositoryRuntime {
  const split = "tenantPool" in pools
    ? pools
    : {
        tenantPool: pools,
        directoryPool: pools,
        close: () => pools.end(),
      };
  const pool = split.tenantPool;
  return {
    driver: "postgres",
    ...createEnterprisePostgresKnowledgeRuntime(pool),
    ...createEnterprisePostgresTerminologyRuntime(pool),
    ...createEnterprisePostgresObservabilityRuntime(pool),
    ...createEnterprisePostgresAuditExportRuntime(pool),
    ...createEnterprisePostgresMeetingRuntime(pool),
    ...createEnterprisePostgresMeetingTranslationRuntime(pool),
    ...createEnterprisePostgresMeetingScreenShareRuntime(pool),
    ...createEnterprisePostgresMeetingMaterialRuntime(pool),
    ...createEnterprisePostgresBusinessRuntimes(pool,
      process.env.ENTERPRISE_WORKER_DISPATCH_SIGNING_SECRET?.trim() ?? ""),
    ...createEnterprisePostgresBillingLifecycleRuntime(pool),
    resolveContext(input) {
      return resolveEnterprisePostgresContext({
        pool: split.directoryPool,
        userId: input.userId,
        selectedTenantId: input.selectedTenantId,
        traceId: input.traceId,
      });
    },
    listMemberships(input) {
      return listEnterprisePostgresMemberships({
        pool: split.directoryPool,
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
    publishCommunicationPolicy(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.communicationPolicies.publish(input.policy);
          if (result.status !== "created") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "communication_policy.publish",
            resourceType: "communication_policy",
            resourceId: result.id,
            result: "completed",
            details: { policyVersion: input.policy.policyVersion },
            createdAt: input.policy.publishedAt,
          }));
          return result;
        },
      );
    },
    configureUsageBudget(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.usageBudgets.configure(input.budget);
          if (result.status !== "created" && result.status !== "updated") {
            return result;
          }
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "usage_budget.configure",
            resourceType: "usage_budget",
            resourceId: result.budget.id,
            result: "completed",
            details: {
              category: result.budget.category,
              unit: result.budget.unit,
              limitAmount: result.budget.limitAmount,
              version: result.budget.version,
            },
            createdAt: result.budget.updatedAt,
          }));
          return result;
        },
      );
    },
    async listUsageBudgets(input) {
      const budgets = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.usageBudgets.list(),
      );
      return { status: "ready", budgets };
    },
    async getBillingEntitlements(input) {
      const state = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.billingEntitlements.current(),
      );
      return state ? { status: "ready", state } : { status: "not_found" };
    },
    changeSubscription(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.billingEntitlements.change(input.change);
          if (result.status !== "changed") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "subscription.change",
            resourceType: "subscription",
            resourceId: result.subscription.id,
            result: "completed",
            details: {
              billingAccountId: result.account.id,
              planCode: result.subscription.planCode,
              planVersion: result.subscription.planVersion,
              entitlementVersion: result.entitlement.entitlementVersion,
              seats: result.subscription.seats,
            },
            createdAt: result.subscription.updatedAt,
          }));
          return result;
        },
      );
    },
    recordUsageEvent(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.usageAccounting.record(input.event),
      );
    },
    adjustUsage(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.usageAccounting.adjust(input.adjustment);
          if (result.status !== "adjusted") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "usage.adjustment",
            resourceType: "usage_ledger",
            resourceId: result.adjustment.adjustmentLedgerEntryId,
            result: "completed",
            details: {
              targetLedgerEntryId: result.adjustment.targetLedgerEntryId,
              deltaAmount: result.adjustment.deltaAmount,
              reasonCode: result.adjustment.reasonCode,
            },
            createdAt: result.adjustment.createdAt,
          }));
          return result;
        },
      );
    },
    rebuildUsagePeriod(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.usageAccounting.rebuild(input.period),
      );
    },
    async listUsagePeriodAggregates(input) {
      const aggregates = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.usageAccounting.list(),
      );
      return { status: "ready", aggregates };
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
    async pendingTenantLifecycleJobRefs() { return []; },
    async close() { await split.close(); },
  };
}
