import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import type { EnterprisePostgresPool } from "./enterprise-postgres-client.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresBillingLifecycleRuntime(
  pool: EnterprisePostgresPool,
) {
  return {
    ingestBillingLifecycleEvent(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.billingLifecycle.ingest(input.event),
      );
    },
    async getBillingLifecycleStatus(input) {
      const lifecycle = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.billingLifecycle.status(),
        { readOnlyRepeatableRead: true },
      );
      return lifecycle ? { status: "ready" as const, lifecycle } :
        { status: "not_found" as const };
    },
  } satisfies Pick<EnterpriseRepositoryRuntime,
    "ingestBillingLifecycleEvent" | "getBillingLifecycleStatus">;
}
