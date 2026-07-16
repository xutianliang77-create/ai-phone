import type {
  EnterpriseTenantContext,
} from "../../modules/enterprise/enterprise-tenant-context.js";
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

export interface EnterprisePostgresUnitOfWork {
  tenant: EnterpriseTenantPostgresRepository;
  lifecycle: EnterpriseLifecyclePostgresRepository;
  events: EnterpriseEventsPostgresRepository;
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
    }),
  );
}
