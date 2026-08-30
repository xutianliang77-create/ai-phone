import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseBillingLifecycleCommand } from
  "../../modules/enterprise/enterprise-billing-lifecycle.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import type { EnterpriseBillingLifecycleQueuePostgresRepository } from
  "./enterprise-postgres-billing-lifecycle-queue.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export async function runEnterpriseBillingLifecycleClaim(input: {
  pool: EnterprisePostgresPool;
  command: EnterpriseBillingLifecycleCommand;
  workerId: string;
  traceId: string;
  assertOwned(): Promise<void>;
}): Promise<"completed" | "busy"> {
  await input.assertOwned();
  return withEnterprisePostgresUnitOfWork(
    input.pool,
    createEnterpriseTenantContext({
      tenantId: input.command.tenantId,
      actorUserId: "system:enterprise-billing-lifecycle",
      traceId: input.traceId,
    }),
    async (unit) => {
      const result = await unit.billingLifecycle.apply({
        commandId: input.command.id,
        attempt: input.command.attempts,
        leaseGeneration: input.command.leaseGeneration,
        workerId: input.workerId,
      });
      if (result.status === "stale" || result.status === "not_found") {
        return "busy" as const;
      }
      if (result.status === "completed" && "decisionId" in result) {
        const processedAt = new Date(result.processedAt);
        if (result.closedPeriod) {
          const dimensions = await unit.billingLifecycle.usageDimensions(
            result.closedPeriod,
          );
          for (const dimension of dimensions) {
            const rebuilt = await unit.usageAccounting.rebuild({
              ...dimension,
              periodStart: result.closedPeriod.start,
              periodEnd: result.closedPeriod.end,
              now: processedAt,
            });
            if (rebuilt.status !== "rebuilt") {
              throw new Error("Billing lifecycle usage reconciliation failed");
            }
          }
        }
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: createEnterpriseTenantContext({
            tenantId: input.command.tenantId,
            actorUserId: "system:enterprise-billing-lifecycle",
            traceId: input.traceId,
          }),
          action: `subscription.lifecycle.${result.reasonCode}`,
          resourceType: "subscription",
          resourceId: result.subscriptionId ?? input.command.eventId,
          result: result.action === "applied" ? "completed" : "denied",
          details: {
            commandId: input.command.id,
            eventId: input.command.eventId,
            decisionId: result.decisionId,
            action: result.action,
            reasonCode: result.reasonCode,
            accountStatus: result.accountStatus,
            subscriptionStatus: result.subscriptionStatus,
            closedPeriodStart: result.closedPeriod?.start ?? null,
            closedPeriodEnd: result.closedPeriod?.end ?? null,
          },
          createdAt: result.processedAt,
        }));
      }
      await input.assertOwned();
      return "completed" as const;
    },
  );
}

export function finishEnterpriseBillingLifecycleWork(
  pool: EnterprisePostgresPool,
  claim: Awaited<ReturnType<EnterpriseBillingLifecycleQueuePostgresRepository["claim"]>>,
  workerId: string,
  traceId: string,
  assertOwned: () => Promise<void>,
) {
  if (claim.status === "failed") return Promise.resolve("failed" as const);
  if (claim.status !== "claimed") return Promise.resolve("busy" as const);
  return runEnterpriseBillingLifecycleClaim({
    pool, command: claim.command, workerId, traceId, assertOwned,
  });
}
