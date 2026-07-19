import type { EnterpriseSupportSessionAggregate } from
  "../../modules/enterprise/enterprise-support.js";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseSupportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { createEnterprisePostgresSupportSession } from
  "./enterprise-postgres-support-create.js";
import { ingestEnterprisePostgresSupportInbound } from
  "./enterprise-postgres-support-inbound.js";
import { resolveEnterprisePostgresSupportKnowledge } from
  "./enterprise-postgres-support-rag.js";
import {
  withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

export function createEnterprisePostgresSupportRuntime(
  pool: EnterpriseTenantPostgresPool,
): EnterpriseSupportRepositoryRuntime {
  return {
    createSupportChannel(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.support.createChannel(input.channel);
        if (result.status === "created") {
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context, action: "support.channel.create",
            resourceType: "support_channel", resourceId: result.channel.id,
            result: "completed", details: { channelType: result.channel.channelType,
              provider: result.channel.provider, status: result.channel.status },
            createdAt: result.channel.createdAt,
          }));
        }
        return result;
      });
    },
    authorizeSupportInboundChannel(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const [tenant, channel] = await Promise.all([
          unit.tenant.findTenant(), unit.support.findChannel(input.channelId),
        ]);
        if (!tenant || tenant.status !== "active" || !tenant.cellId) {
          return { status: "route_not_ready" };
        }
        if (!channel || channel.channelType !== input.channelType) {
          return { status: "channel_not_found" };
        }
        if (channel.status !== "active") return { status: "channel_unavailable" };
        return { status: "ready", authorization: { channel, route: {
          tenantId: tenant.id, channelId: channel.id,
          channelType: channel.channelType, homeRegion: tenant.homeRegion,
          cellId: tenant.cellId, routeEpoch: tenant.version,
        } } };
      });
    },
    ingestSupportInbound(input) {
      return ingestEnterprisePostgresSupportInbound(pool, input);
    },
    createSupportSession(input) {
      return createEnterprisePostgresSupportSession(
        pool, input, loadEnterprisePostgresSupportAggregate,
      );
    },
    getSupportSession(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const session = await unit.support.findSession(input.sessionId);
        return session
          ? { status: "ready",
              aggregate: await loadEnterprisePostgresSupportAggregate(unit, session) }
          : { status: "not_found" };
      });
    },
    resolveSupportKnowledge(input) {
      return resolveEnterprisePostgresSupportKnowledge(pool, input);
    },
    listRecoverableSupportSessions(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready",
        sessions: await Promise.all(
          (await unit.support.listRecoverable()).map((session) =>
            loadEnterprisePostgresSupportAggregate(unit, session)
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
          aggregate: await loadEnterprisePostgresSupportAggregate(unit, result.session),
        };
      });
    },
  };
}

export async function loadEnterprisePostgresSupportAggregate(
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
