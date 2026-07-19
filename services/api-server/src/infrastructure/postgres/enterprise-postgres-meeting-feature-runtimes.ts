import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { createEnvironmentEnterprisePostgresMeetingCalendarRuntime } from
  "./enterprise-postgres-meeting-calendar-runtime.js";
import { createEnterprisePostgresMeetingScreenOcrRuntime } from
  "./enterprise-postgres-meeting-screen-ocr-runtime.js";

export function createEnterprisePostgresMeetingFeatureRuntimes(
  pool: EnterpriseTenantPostgresPool,
  dispatchSigningSecret: string,
) {
  return {
    ...createEnterprisePostgresMeetingScreenOcrRuntime(pool, dispatchSigningSecret),
    ...createEnvironmentEnterprisePostgresMeetingCalendarRuntime(pool),
  };
}
