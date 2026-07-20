import { randomUUID } from "node:crypto";
import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMarketingAgentRunRecord } from
  "../../modules/enterprise/enterprise-marketing-agent.js";
import { enterpriseMarketingHandoffHash } from
  "../../modules/enterprise/enterprise-marketing-handoff.js";
import type { EnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import type { EnterprisePostgresUnitOfWork } from "./enterprise-postgres-unit-of-work.js";

export async function enterpriseMarketingHandoffReadiness(
  unit: EnterprisePostgresUnitOfWork,
  campaignId: string,
) {
  const policy = await unit.marketingHandoffs.findPolicy(campaignId);
  if (!policy) return { status: "not_configured" as const,
    reasonCode: "marketing_handoff_policy_not_configured" };
  const [queue, channel] = await Promise.all([
    unit.support.findQueue(policy.supportQueueId),
    unit.support.findChannel(policy.supportChannelId),
  ]);
  if (!queue || queue.status !== "active") return { status: "not_ready" as const,
    reasonCode: "marketing_handoff_queue_not_ready" };
  if (!channel || channel.status !== "active" || channel.channelType !== "pstn") {
    return { status: "not_ready" as const,
      reasonCode: "marketing_handoff_channel_not_ready" };
  }
  return { status: "ready" as const, policy };
}

export async function materializeEnterpriseMarketingHandoff(
  unit: EnterprisePostgresUnitOfWork,
  run: EnterpriseMarketingAgentRunRecord,
  aiFencedAt: string,
  context: EnterpriseTenantContext,
) {
  const prior = await unit.marketingHandoffs.findByRun(run.id, true);
  if (prior) return { status: "replayed" as const, handoff: prior };
  const readiness = await enterpriseMarketingHandoffReadiness(unit, run.campaignId);
  if (readiness.status !== "ready") return readiness;
  const lead = await unit.marketingHandoffs.findLeadContact(run.leadId);
  if (!lead) return { status: "not_ready" as const,
    reasonCode: "marketing_handoff_lead_not_found" };
  const externalId = `marketing-lead:${lead.id}`;
  let customer = await unit.support.findCustomerByExternalId(externalId);
  if (!customer) {
    const created = await unit.support.createCustomer({ id: randomUUID(), externalId,
      phoneHash: lead.phoneHash, ...(lead.locale ? { locale: lead.locale } : {}),
      attributes: { source: "marketing_handoff", phoneHint: lead.phoneHint,
        campaignId: run.campaignId }, consentScope: ["automated_marketing_call"],
      createdAt: aiFencedAt });
    customer = created.status === "created" ? created.customer
      : await unit.support.findCustomerByExternalId(externalId);
  }
  if (!customer) throw new Error("Marketing handoff customer conflict");
  const requestHash = enterpriseMarketingHandoffHash({ runId: run.id,
    dispatchId: run.dispatchId, campaignId: run.campaignId, leadId: run.leadId,
    policyId: readiness.policy.id, policyVersion: readiness.policy.version,
    supportQueueId: readiness.policy.supportQueueId,
    supportChannelId: readiness.policy.supportChannelId, aiFencedAt });
  const sessionResult = await unit.support.createSession({ id: randomUUID(),
    customerId: customer.id, channelId: readiness.policy.supportChannelId,
    intent: "marketing_handoff", priority: 100, createdAt: aiFencedAt,
    idempotencyKey: `marketing-handoff:${run.id}`, requestHash });
  if (sessionResult.status === "idempotency_conflict") {
    throw new Error("Marketing handoff support session conflict");
  }
  let session = sessionResult.session;
  if (session.status === "created") {
    const waiting = await unit.support.transition({ sessionId: session.id,
      status: "waiting", queueId: readiness.policy.supportQueueId,
      expectedVersion: session.version, occurredAt: aiFencedAt });
    if (waiting.status !== "updated") {
      throw new Error("Marketing handoff queue transition failed");
    }
    session = waiting.session;
  }
  if (session.status === "waiting") {
    const handoff = await unit.support.transition({ sessionId: session.id,
      status: "handoff_requested", expectedVersion: session.version,
      occurredAt: aiFencedAt });
    if (handoff.status !== "updated") {
      throw new Error("Marketing handoff request transition failed");
    }
    session = handoff.session;
  }
  if (session.status !== "handoff_requested") {
    throw new Error("Marketing handoff support session is not queueable");
  }
  const created = await unit.marketingHandoffs.create({ id: randomUUID(), run,
    supportSessionId: session.id, policy: readiness.policy, aiFencedAt });
  if (created.status === "created") await unit.tenant.appendAuditEvent(
    createEnterpriseAuditEvent({ context,
      action: "marketing.handoff.queued", resourceType: "marketing_handoff",
      resourceId: created.handoff.id, result: "completed",
      details: { campaignId: run.campaignId, dispatchId: run.dispatchId,
        supportSessionId: session.id, supportQueueId: readiness.policy.supportQueueId,
        aiSpeechFence: "stopped", aiStopDeadlineMs: 300,
        timeoutAt: created.handoff.timeoutAt,
        timeoutAction: created.handoff.timeoutAction }, createdAt: aiFencedAt }));
  return created;
}
