import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseCampaignApprovalRepositoryRuntime } from
  "../../modules/enterprise/enterprise-campaign-approval-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseCampaignApprovalRepositoryRuntime>;

export function createEnterprisePostgresCampaignApprovalRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    getCampaignApproval(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        return { status: "ready" as const,
          ...await unit.campaignApprovals.get(input.campaignId) };
      });
    },
    validateCampaign(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const campaign = await unit.campaigns.find(input.campaignId, true);
        if (!campaign) return { status: "not_found" as const };
        const result = await unit.campaignApprovals.validate({ ...input, campaign });
        if (result.status === "created") await audit(unit, input.context,
          "campaign.approval_validate", input.campaignId, result.validation.validatedAt,
          { validationId: result.validation.id, status: result.validation.status,
            snapshotHash: result.validation.snapshotHash,
            issueCount: result.validation.issues.length,
            leadCount: result.validation.leads.length,
            consentCount: result.validation.consents.length,
            suppressionCount: result.validation.suppressions.length });
        if (result.status !== "created" && result.status !== "replayed") return result;
        const refreshed = result.validation.status === "ready"
          ? await unit.campaigns.find(input.campaignId) : undefined;
        return { ...result, ...(refreshed ? { campaign: refreshed } : {}) };
      });
    },
    approveCampaign(input) { return decide(pool, input, "approved"); },
    rejectCampaign(input) { return decide(pool, input, "rejected"); },
  };
}

async function decide(pool: EnterpriseTenantPostgresPool,
  input: Parameters<Runtime["approveCampaign"]>[0] |
    Parameters<Runtime["rejectCampaign"]>[0],
  decision: "approved" | "rejected") {
  return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
    const campaign = await unit.campaigns.find(input.campaignId, true);
    if (!campaign) return { status: "not_found" as const };
    const result = await unit.campaignApprovals.decide({ ...input, campaign, decision,
      ...(decision === "rejected" && "reason" in input ? { reason: input.reason } : {}) });
    if (result.status === "idempotency_conflict" || result.status === "conflict" ||
      result.status === "not_decidable" || result.status === "validation_stale") {
      return { status: result.status };
    }
    if (!result.decision) throw new Error("Campaign decision missing");
    const refreshed = await unit.campaigns.find(input.campaignId);
    if (!refreshed) throw new Error("Campaign decision campaign missing");
    if (result.status !== "replayed") await audit(unit, input.context,
      `campaign.${decision}`, input.campaignId, result.decision.decidedAt,
      { decisionId: result.decision.id,
        validationSnapshotId: result.decision.validationSnapshotId,
        decisionHash: result.decision.decisionHash,
        ...(result.decision.rejectionReason
          ? { rejectionReason: result.decision.rejectionReason } : {}) });
    return { status: result.status, decision: result.decision, campaign: refreshed };
  });
}

type Unit = Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0];
async function audit(unit: Unit,
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
  action: string, resourceId: string, createdAt: string,
  details: Record<string, unknown>) {
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context, action,
    resourceType: "campaign_approval", resourceId, result: "completed",
    details, createdAt }));
}
