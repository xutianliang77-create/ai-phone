import type { EnterpriseReleaseControlRuntime } from
  "../../modules/enterprise/enterprise-release-control-runtime.js";
import { evaluateEnterpriseReleaseControl } from
  "../../modules/enterprise/enterprise-release-control.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseReleaseControlRuntime>;

export function createEnterprisePostgresReleaseControlRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    async listReleaseControls(input) {
      const controls = await withEnterprisePostgresUnitOfWork(
        pool, input.context, (unit) => unit.releaseControls.list(),
        { readOnlyRepeatableRead: true },
      );
      return { status: "ready", controls };
    },
    async evaluateReleaseControl(input) {
      const control = await withEnterprisePostgresUnitOfWork(
        pool, input.context,
        (unit) => unit.releaseControls.find(input.capability),
        { readOnlyRepeatableRead: true },
      );
      return { status: "ready", decision: evaluateEnterpriseReleaseControl(
        control, input.capability, input.now, input.probe,
      ) };
    },
    changeReleaseControl(input) {
      return withEnterprisePostgresUnitOfWork(
        pool, systemContext(input),
        (unit) => unit.releaseControls.change(input),
      );
    },
    recordReleaseOutcome(input) {
      return withEnterprisePostgresUnitOfWork(
        pool, systemContext(input),
        (unit) => unit.releaseControls.recordOutcome(input),
      );
    },
  };
}

function systemContext(input: {
  tenantId: string;
  actorId: string;
  traceId: string;
}) {
  return createEnterpriseTenantContext({
    tenantId: input.tenantId,
    actorUserId: input.actorId,
    traceId: input.traceId,
  });
}
