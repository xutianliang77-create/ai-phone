import type { EnterpriseContactDirectoryRepositoryRuntime } from
  "../../modules/enterprise/enterprise-contact-directory-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseContactDirectoryRepositoryRuntime>;

export function createEnterprisePostgresContactDirectoryRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    listEnterpriseLeads(input) {
      return read(pool, input.context, async (unit) => {
        const result = await unit.leadDirectory.list({ limit: input.limit,
          before: input.before, evaluatedAt: input.evaluatedAt });
        return { status: "ready" as const, ...result };
      });
    },
    getEnterpriseLead(input) {
      return read(pool, input.context, async (unit) => {
        const lead = await unit.leadDirectory.find(
          input.leadId, input.evaluatedAt,
        );
        return lead ? { status: "ready" as const, lead }
          : { status: "not_found" as const };
      });
    },
    listEnterpriseCustomers(input) {
      return read(pool, input.context, async (unit) => {
        const result = await unit.customerDirectory.list({
          limit: input.limit, before: input.before,
        });
        return { status: "ready" as const, ...result };
      });
    },
    getEnterpriseCustomer(input) {
      return read(pool, input.context, async (unit) => {
        const customer = await unit.customerDirectory.find(input.customerId);
        if (!customer) return { status: "not_found" as const };
        const recentSessions = await unit.customerDirectory.recentSessions(
          input.customerId, 20,
        );
        const recentCases = await unit.customerDirectory.recentCases(
          input.customerId, 20,
        );
        return { status: "ready" as const, customer, recentSessions, recentCases };
      });
    },
  };
}

function read<T>(pool: EnterpriseTenantPostgresPool,
  context: Parameters<typeof withEnterprisePostgresUnitOfWork>[1],
  operation: (unit: Parameters<Parameters<
    typeof withEnterprisePostgresUnitOfWork>[2]>[0]) => Promise<T>) {
  return withEnterprisePostgresUnitOfWork(pool, context, operation,
    { readOnlyRepeatableRead: true });
}
