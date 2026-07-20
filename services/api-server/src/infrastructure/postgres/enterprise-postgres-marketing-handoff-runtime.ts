import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseMarketingHandoffPolicyDto } from
  "../../modules/enterprise/enterprise-marketing-handoff.js";
import type { EnterpriseMarketingHandoffProvider } from
  "../../modules/enterprise/enterprise-marketing-handoff-provider.js";
import type { EnterpriseMarketingHandoffRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-handoff-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { enterpriseMarketingHandoffReadiness } from
  "./enterprise-postgres-marketing-handoff-materializer.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";

type Runtime = Required<EnterpriseMarketingHandoffRepositoryRuntime>;

export function createEnterprisePostgresMarketingHandoffRuntime(
  pool: EnterpriseTenantPostgresPool,
  provider: EnterpriseMarketingHandoffProvider,
): Runtime {
  return {
    processMarketingHandoffTimeouts(input) {
      const context = createEnterpriseTenantContext({ tenantId: input.tenantId,
        actorUserId: "system:enterprise-marketing-handoff", traceId: input.traceId });
      return withEnterprisePostgresUnitOfWork(pool, context, async (unit) => {
        const tenant = await unit.tenant.findTenant({ lock: true });
        if (!tenant || tenant.status !== "active" ||
          tenant.homeRegion !== input.homeRegion || tenant.cellId !== input.cellId ||
          tenant.version !== input.routeEpoch) return { status: "route_mismatch" as const };
        const due = await unit.marketingHandoffs.listDue(input.now, input.batchSize);
        const processed = [] as Array<{ handoffId: string; supportSessionId: string;
          outcome: "timed_out" | "callback_required" }>;
        for (const item of due) {
          const ended = await unit.support.transition({
            sessionId: item.handoff.supportSessionId, status: "ended",
            expectedVersion: item.supportSessionVersion, occurredAt: input.now });
          if (ended.status !== "updated") {
            throw new Error("Marketing handoff timeout session transition failed");
          }
          const handoff = await unit.marketingHandoffs.recordTimeout(
            item.handoff.id, item.handoff.timeoutAction, input.now);
          if (!handoff) throw new Error("Marketing handoff timeout evidence failed");
          const outcome = handoff.status === "callback_required"
            ? "callback_required" as const : "timed_out" as const;
          processed.push({ handoffId: handoff.id,
            supportSessionId: handoff.supportSessionId, outcome });
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context,
            action: "marketing.handoff.timeout", resourceType: "marketing_handoff",
            resourceId: handoff.id, result: "completed",
            details: { supportSessionId: handoff.supportSessionId,
              workerId: input.workerId, outcome,
              physicalProviderAction: "not_verified" }, createdAt: input.now }));
        }
        return { status: processed.length ? "processed" as const : "empty" as const,
          processed };
      });
    },
    getMarketingHandoffStatus(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        const readiness = await enterpriseMarketingHandoffReadiness(
          unit, input.campaignId);
        const policy = readiness.status === "ready" ? readiness.policy
          : await unit.marketingHandoffs.findPolicy(input.campaignId);
        return { status: "ready" as const, campaignId: input.campaignId,
          ...(policy ? { policy: enterpriseMarketingHandoffPolicyDto(policy) } : {}),
          readiness: readiness.status === "ready"
            ? { status: "ready" as const }
            : { status: readiness.status, reasonCode: readiness.reasonCode },
          provider: provider.readiness() };
      });
    },
    upsertMarketingHandoffPolicy(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const campaign = await unit.campaigns.find(input.campaignId, true);
        if (!campaign) return { status: "not_found" as const };
        if (campaign.status !== "draft" || campaign.approvalStatus !== "not_submitted") {
          return { status: "not_editable" as const };
        }
        const [queue, channel] = await Promise.all([
          unit.support.findQueue(input.supportQueueId),
          unit.support.findChannel(input.supportChannelId),
        ]);
        if (!queue || queue.status !== "active" || !channel ||
          channel.status !== "active" || channel.channelType !== "pstn") {
          return { status: "resource_not_ready" as const };
        }
        const result = await unit.marketingHandoffs.upsertPolicy({ ...input,
          id: input.policyId });
        if (!("policy" in result) || !result.policy) return result;
        const policy = result.policy;
        if (result.status !== "replayed") await unit.tenant.appendAuditEvent(
          createEnterpriseAuditEvent({ context: input.context,
            action: `marketing.handoff_policy.${result.status}`,
            resourceType: "marketing_handoff_policy", resourceId: policy.id,
            result: "completed", details: { campaignId: input.campaignId,
              supportQueueId: policy.supportQueueId,
              supportChannelId: policy.supportChannelId,
              timeoutSeconds: policy.timeoutSeconds,
              timeoutAction: policy.timeoutAction, version: policy.version },
            createdAt: input.occurredAt }));
        return { status: result.status, policy: enterpriseMarketingHandoffPolicyDto(policy) };
      });
    },
  };
}
