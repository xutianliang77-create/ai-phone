import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseSupportSessionAggregate } from
  "../../modules/enterprise/enterprise-support.js";
import type { EnterpriseSupportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import {
  withEnterprisePostgresUnitOfWork,
  type EnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

type CreateInput = Parameters<NonNullable<
  EnterpriseSupportRepositoryRuntime["createSupportSession"]
>>[0];
type AggregateLoader = (
  unit: EnterprisePostgresUnitOfWork,
  session: EnterpriseSupportSessionAggregate["session"],
) => Promise<EnterpriseSupportSessionAggregate>;

export async function createEnterprisePostgresSupportSession(
  pool: EnterpriseTenantPostgresPool,
  input: CreateInput,
  aggregate: AggregateLoader,
) {
  try {
    return await withEnterprisePostgresUnitOfWork(
      pool,
      input.context,
      async (unit) => {
        const prior = await unit.support.findByCreationKey(
          input.session.idempotencyKey,
        );
        if (prior) {
          return prior.requestHash === input.session.requestHash
            ? { status: "replayed" as const,
                aggregate: await aggregate(unit, prior.session) }
            : { status: "idempotency_conflict" as const };
        }
        const [tenant, customer, channel] = await Promise.all([
          unit.tenant.findTenant({ lock: true }),
          unit.support.findCustomer(input.session.customerId),
          unit.support.findChannel(input.session.channelId),
        ]);
        if (!tenant || tenant.status !== "active" || !tenant.cellId) {
          return { status: "route_not_ready" as const };
        }
        if (!customer || !channel) return { status: "resource_not_found" as const };
        if (channel.status !== "active") {
          return { status: "channel_unavailable" as const };
        }
        const policyVersion = await unit.communicationPolicies
          .currentPublishedVersion();
        if (!policyVersion) return { status: "policy_not_ready" as const };
        if (!await unit.billingEntitlements.current(new Date(input.session.createdAt))) {
          return { status: "entitlement_not_ready" as const };
        }
        const created = await unit.support.createSession(input.session);
        if (created.status === "idempotency_conflict") return created;
        if (created.status === "replayed") {
          return {
            status: "replayed" as const,
            aggregate: await aggregate(unit, created.session),
          };
        }
        const binding = await unit.communicationBindings.bind({
          bindingId: input.bindingId,
          communicationSessionId: input.communicationSessionId,
          kind: "support",
          businessId: created.session.id,
          homeRegion: tenant.homeRegion,
          cellId: tenant.cellId,
          routeEpoch: tenant.version,
          policyVersion,
          startedAt: input.session.createdAt,
        });
        if (binding.status === "entitlement_unavailable") {
          throw new SupportCreateAbort();
        }
        if (binding.status !== "created") {
          throw new Error("Enterprise support communication binding conflict");
        }
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context,
          action: "support.session.create",
          resourceType: "support_session",
          resourceId: created.session.id,
          result: "completed",
          details: {
            channelId: created.session.channelId,
            customerId: created.session.customerId,
            status: created.session.status,
          },
          createdAt: input.session.createdAt,
        }));
        return {
          status: "created" as const,
          aggregate: await aggregate(unit, created.session),
        };
      },
    );
  } catch (error) {
    if (error instanceof SupportCreateAbort) {
      return { status: "entitlement_not_ready" as const };
    }
    throw error;
  }
}

class SupportCreateAbort extends Error {}
