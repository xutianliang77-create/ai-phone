import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseUsageAdjustmentPostgresRepository,
} from "./enterprise-postgres-usage-adjustment.js";
import {
  EnterpriseUsageAggregatePostgresRepository,
} from "./enterprise-postgres-usage-aggregate.js";
import {
  EnterpriseUsageEventPostgresRepository,
} from "./enterprise-postgres-usage-event.js";

export class EnterpriseUsageAccountingPostgresRepository {
  readonly events: EnterpriseUsageEventPostgresRepository;
  readonly adjustments: EnterpriseUsageAdjustmentPostgresRepository;
  readonly aggregates: EnterpriseUsageAggregatePostgresRepository;

  constructor(session: EnterpriseTenantPostgresSession) {
    this.events = new EnterpriseUsageEventPostgresRepository(session);
    this.adjustments = new EnterpriseUsageAdjustmentPostgresRepository(session);
    this.aggregates = new EnterpriseUsageAggregatePostgresRepository(session);
  }

  record(
    ...args: Parameters<EnterpriseUsageEventPostgresRepository["record"]>
  ) {
    return this.events.record(...args);
  }
  recordSettlement(
    ...args: Parameters<EnterpriseUsageEventPostgresRepository["recordSettlement"]>
  ) {
    return this.events.recordSettlement(...args);
  }
  adjust(
    ...args: Parameters<EnterpriseUsageAdjustmentPostgresRepository["adjust"]>
  ) {
    return this.adjustments.adjust(...args);
  }
  rebuild(
    ...args: Parameters<EnterpriseUsageAggregatePostgresRepository["rebuild"]>
  ) {
    return this.aggregates.rebuild(...args);
  }
  list() {
    return this.aggregates.list();
  }
}
