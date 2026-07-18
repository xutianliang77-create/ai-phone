import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
import {
  createEnterpriseCommunicationBindingPostgresRepository,
  type EnterpriseCommunicationBindingPostgresRepository,
} from "./enterprise-postgres-communication-binding.repository.js";
import {
  createEnterpriseCommunicationPostgresRepository,
  type EnterpriseCommunicationPostgresRepository,
} from "./enterprise-postgres-communication.repository.js";
import {
  createEnterpriseEventsPostgresRepository,
  type EnterpriseEventsPostgresRepository,
} from "./enterprise-postgres-events.repository.js";
import {
  createEnterpriseLifecyclePostgresRepository,
  type EnterpriseLifecyclePostgresRepository,
} from "./enterprise-postgres-lifecycle.repository.js";
import {
  createEnterpriseTenantPostgresRepository,
  type EnterpriseTenantPostgresRepository,
} from "./enterprise-postgres-tenant.repository.js";
import {
  withEnterpriseTenantPostgresSession,
  type EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  EnterpriseWorkerDispatchPostgresRepository,
} from "./enterprise-postgres-worker-dispatch.repository.js";
import {
  EnterpriseCommunicationPolicyPostgresRepository,
} from "./enterprise-postgres-communication-policy.repository.js";
import {
  EnterpriseUsageBudgetPostgresRepository,
} from "./enterprise-postgres-usage-budget.repository.js";
import {
  EnterpriseBillingEntitlementPostgresRepository,
} from "./enterprise-postgres-billing-entitlement.repository.js";
import {
  EnterpriseUsageAccountingPostgresRepository,
} from "./enterprise-postgres-usage-accounting.repository.js";

export interface EnterprisePostgresUnitOfWork {
  tenant: EnterpriseTenantPostgresRepository;
  lifecycle: EnterpriseLifecyclePostgresRepository;
  events: EnterpriseEventsPostgresRepository;
  communication: EnterpriseCommunicationPostgresRepository;
  communicationBindings: EnterpriseCommunicationBindingPostgresRepository;
  communicationPolicies: EnterpriseCommunicationPolicyPostgresRepository;
  billingEntitlements: EnterpriseBillingEntitlementPostgresRepository;
  usageBudgets: EnterpriseUsageBudgetPostgresRepository;
  usageAccounting: EnterpriseUsageAccountingPostgresRepository;
  workerDispatches: EnterpriseWorkerDispatchPostgresRepository;
}

export function withEnterprisePostgresUnitOfWork<T>(
  pool: EnterpriseTenantPostgresPool,
  context: EnterpriseTenantContext,
  operation: (unit: EnterprisePostgresUnitOfWork) => Promise<T>,
) {
  return withEnterpriseTenantPostgresSession(
    pool,
    context,
    (session) => operation({
      tenant: createEnterpriseTenantPostgresRepository(session),
      lifecycle: createEnterpriseLifecyclePostgresRepository(session),
      events: createEnterpriseEventsPostgresRepository(session),
      communication: createEnterpriseCommunicationPostgresRepository(session),
      communicationBindings:
        createEnterpriseCommunicationBindingPostgresRepository(session),
      communicationPolicies:
        new EnterpriseCommunicationPolicyPostgresRepository(session),
      billingEntitlements:
        new EnterpriseBillingEntitlementPostgresRepository(session),
      usageBudgets: new EnterpriseUsageBudgetPostgresRepository(session),
      usageAccounting: new EnterpriseUsageAccountingPostgresRepository(session),
      workerDispatches: new EnterpriseWorkerDispatchPostgresRepository(session),
    }),
  );
}
