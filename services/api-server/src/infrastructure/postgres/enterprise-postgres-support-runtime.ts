import type { EnterpriseSupportSessionAggregate } from
  "../../modules/enterprise/enterprise-support.js";
import type { EnterpriseSupportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterprisePostgresSupportSession } from
  "./enterprise-postgres-support-create.js";
import {
  withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresSupportRuntime(
  pool: EnterpriseTenantPostgresPool,
): EnterpriseSupportRepositoryRuntime {
  return {
    createSupportSession(input) {
      return createEnterprisePostgresSupportSession(pool, input, aggregate);
    },
    getSupportSession(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const session = await unit.support.findSession(input.sessionId);
        return session
          ? { status: "ready", aggregate: await aggregate(unit, session) }
          : { status: "not_found" };
      });
    },
    listRecoverableSupportSessions(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready",
        sessions: await Promise.all(
          (await unit.support.listRecoverable()).map((session) =>
            aggregate(unit, session)
          ),
        ),
      }));
    },
    transitionSupportSession(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.support.transition(input);
        if (result.status !== "updated") return result;
        return {
          status: "updated",
          aggregate: await aggregate(unit, result.session),
        };
      });
    },
  };
}

async function aggregate(
  unit: EnterprisePostgresUnitOfWork,
  session: EnterpriseSupportSessionAggregate["session"],
): Promise<EnterpriseSupportSessionAggregate> {
  const [channel, customer, queue, cases, toolExecutions, communicationBinding] =
    await Promise.all([
      unit.support.findChannel(session.channelId),
      unit.support.findCustomer(session.customerId),
      session.queueId ? unit.support.findQueue(session.queueId) : null,
      unit.support.cases(session.id),
      unit.support.toolExecutions(session.id),
      unit.communicationBindings.findByBusiness("support", session.id),
    ]);
  if (!channel || !customer || (session.queueId && !queue)) {
    throw new Error("Enterprise support aggregate reference is unavailable");
  }
  return {
    session, channel, customer,
    ...(queue ? { queue } : {}),
    cases, toolExecutions,
    ...(communicationBinding ? { communicationBinding } : {}),
  };
}
