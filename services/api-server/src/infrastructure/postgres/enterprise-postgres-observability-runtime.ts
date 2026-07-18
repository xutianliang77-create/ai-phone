import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterprisePostgresPool,
} from "./enterprise-postgres-client.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresObservabilityRuntime(
  pool: EnterprisePostgresPool,
): Pick<EnterpriseRepositoryRuntime, "getSessionTraceReport"> {
  return {
    async getSessionTraceReport(input) {
      const report = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.observability.sessionReport(input.sessionId),
      );
      return report ? { status: "ready", report } : { status: "not_found" };
    },
  };
}
