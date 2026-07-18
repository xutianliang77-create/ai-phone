import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseUsageBudgetWritePostgresRepository,
} from "./enterprise-postgres-usage-budget-write.js";
import {
  EnterpriseUsageHoldPostgresRepository,
} from "./enterprise-postgres-usage-hold.js";

export class EnterpriseUsageBudgetPostgresRepository {
  private readonly budgets: EnterpriseUsageBudgetWritePostgresRepository;
  private readonly holds: EnterpriseUsageHoldPostgresRepository;

  constructor(session: EnterpriseTenantPostgresSession) {
    this.budgets = new EnterpriseUsageBudgetWritePostgresRepository(session);
    this.holds = new EnterpriseUsageHoldPostgresRepository(session);
  }

  configure(...args: Parameters<EnterpriseUsageBudgetWritePostgresRepository["configure"]>) {
    return this.budgets.configure(...args);
  }
  list(...args: Parameters<EnterpriseUsageBudgetWritePostgresRepository["list"]>) {
    return this.budgets.list(...args);
  }
  hold(...args: Parameters<EnterpriseUsageHoldPostgresRepository["hold"]>) {
    return this.holds.hold(...args);
  }
  settle(...args: Parameters<EnterpriseUsageHoldPostgresRepository["settle"]>) {
    return this.holds.settle(...args);
  }
}
