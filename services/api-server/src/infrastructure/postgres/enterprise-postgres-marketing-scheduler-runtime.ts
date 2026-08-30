import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMarketingSchedulerRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-scheduler-runtime.js";
import { issueMarketingSchedulerClaimToken, marketingSchedulerHoldHash } from
  "../../modules/enterprise/enterprise-marketing-scheduler.js";
import type { EnterpriseMarketingClaimedTask } from
  "../../modules/enterprise/enterprise-marketing-scheduler.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { marketingAdmissionHash, marketingAdmissionId,
  marketingAdmissionOwner } from "./enterprise-postgres-marketing-admission.js";

type Runtime = Required<EnterpriseMarketingSchedulerRepositoryRuntime>;
const entitlementKey = "worker.voice_agent_runtime.concurrent";

export function createEnterprisePostgresMarketingSchedulerRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    getMarketingSchedulerStatus(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const campaign = await unit.campaigns.find(input.campaignId);
        if (!campaign) return { status: "not_found" as const };
        const now = new Date();
        const entitlement = await unit.billingEntitlements.current(now);
        const value = entitlement?.entitlement.entitlements[entitlementKey];
        const tenantConcurrencyLimit = value?.enabled && value.limit !== null && value.limit > 0
          ? value.limit : undefined;
        const budgets = await unit.usageBudgets.list();
        const budget = budgets.find((item) => item.category === "marketing_call_seconds" &&
          item.unit === "seconds" && item.periodStart <= now.toISOString() &&
          item.periodEnd > now.toISOString());
        return { status: "ready" as const, campaign,
          scheduler: await unit.marketingScheduler.status(campaign.id),
          ...(tenantConcurrencyLimit ? { tenantConcurrencyLimit } : {}),
          budgetStatus: !budget ? "not_configured" as const
            : budget.status === "paused" ? "paused" as const : "ready" as const };
      });
    },
    claimMarketingSchedulerTasks(input) {
      const context = createEnterpriseTenantContext({ tenantId: input.tenantId,
        actorUserId: "system:enterprise-marketing-scheduler", traceId: input.traceId });
      return withEnterprisePostgresUnitOfWork(pool, context, async (unit) => {
        if (!await unit.marketingScheduler.lockRoute(input)) {
          return { status: "route_mismatch" as const };
        }
        const entitlement = await unit.billingEntitlements.current(input.now);
        if (!entitlement) return { status: "entitlement_unavailable" as const };
        const value = entitlement.entitlement.entitlements[entitlementKey];
        if (!value?.enabled || value.limit === null || value.limit < 1) {
          return { status: "entitlement_denied" as const };
        }
        const now = input.now.toISOString();
        await unit.marketingScheduler.reapExpired(now);
        const due = await unit.marketingScheduler.due(now,
          Math.min(input.batchSize * 4, 200));
        const tasks: EnterpriseMarketingClaimedTask[] = []; let capacitySkipped = 0;
        let budgetBlocked: "not_configured" | "paused" | "exhausted" | undefined;
        for (const task of due) {
          if (tasks.length >= input.batchSize) break;
          if (!await unit.marketingScheduler.capacity(task, value.limit)) {
            capacitySkipped += 1; continue;
          }
          const generation = task.dispatchGeneration + 1;
          const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000)
            .toISOString();
          const requestHash = marketingSchedulerHoldHash({ taskId: task.id, generation,
            amount: input.holdSeconds, leaseExpiresAt });
          const admissionIdempotencyKey =
            `marketing-admission:${task.id}:g${generation}`;
          const admissionId = marketingAdmissionId(
            input.tenantId, task.id, generation,
          );
          const admission = await unit.admissions.reserve({
            capability: "marketing_pstn", resourceType: "marketing_pstn",
            grantId: admissionId, idempotencyKey: admissionIdempotencyKey,
            requestHash: marketingAdmissionHash(task.id, generation),
            tenantLimit: value.limit, leaseExpiresAt, now,
          });
          if (admission.status !== "admitted") {
            capacitySkipped += 1; continue;
          }
          const releaseAdmission = () => unit.admissions.release({
            capability: "marketing_pstn", grantId: admissionId, now,
          });
          const hold = await unit.usageBudgets.hold({ category: "marketing_call_seconds",
            unit: "seconds", amount: input.holdSeconds, sourceType: "marketing_call_task",
            sourceRef: task.id, idempotencyKey: `scheduler-hold:${task.id}:g${generation}`,
            requestHash, expiresAt: leaseExpiresAt, now: input.now });
          if (hold.status === "budget_not_configured") {
            await releaseAdmission(); budgetBlocked = "not_configured"; break;
          }
          if (hold.status === "budget_paused") {
            await releaseAdmission(); budgetBlocked = "paused"; break;
          }
          if (hold.status === "budget_exhausted") {
            await releaseAdmission(); budgetBlocked = "exhausted"; break;
          }
          if (hold.status === "idempotency_conflict") {
            throw new Error("Marketing scheduler usage hold conflict");
          }
          if (hold.status !== "created" && hold.status !== "replayed") {
            throw new Error("Marketing scheduler usage hold rejected");
          }
          const token = issueMarketingSchedulerClaimToken();
          const claimed = await unit.marketingScheduler.claim({ task,
            schedulerId: input.schedulerId, tokenHash: token.hash,
            usageHoldId: hold.hold.id, leaseExpiresAt, now });
          if (!claimed) throw new Error("Marketing scheduler task claim conflict");
          if (!await unit.admissions.renew({ capability: "marketing_pstn",
            grantId: admissionId, workerId: marketingAdmissionOwner(task.id),
            leaseExpiresAt, now })) {
            throw new Error("Marketing scheduler admission lease lost");
          }
          tasks.push({ ...claimed, usageHoldId: hold.hold.id,
            claimOwner: input.schedulerId, claimTokenHash: token.hash,
            leaseExpiresAt, claimToken: token.token });
        }
        if (tasks.length) await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context, action: "marketing_scheduler.claim", resourceType: "marketing_scheduler",
          resourceId: input.tenantId, result: "completed", createdAt: now,
          details: { schedulerId: input.schedulerId, claimedCount: tasks.length,
            capacitySkipped, ...(budgetBlocked ? { budgetBlocked } : {}),
            cellId: input.cellId, routeEpoch: input.routeEpoch } }));
        return { status: tasks.length ? "claimed" as const : "empty" as const,
          tasks, capacitySkipped, ...(budgetBlocked ? { budgetBlocked } : {}) };
      });
    },
  };
}
