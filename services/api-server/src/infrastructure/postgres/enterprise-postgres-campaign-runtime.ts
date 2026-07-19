import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseCampaignRepositoryRuntime } from
  "../../modules/enterprise/enterprise-campaign-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseCampaignRepositoryRuntime>;

export function createEnterprisePostgresCampaignRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    createCampaign(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.campaigns.create(input.campaign);
        if (result.status === "created") await audit(unit, input.context,
          "campaign.create", result.campaign.id, result.campaign.createdAt, {
            status: result.campaign.status, countryCount: result.campaign.countryCodes.length,
            languageCount: result.campaign.languageCodes.length,
            concurrencyLimit: result.campaign.concurrencyLimit });
        return result;
      });
    },
    getCampaign(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const campaign = await unit.campaigns.find(input.campaignId);
        return campaign ? { status: "ready" as const, campaign }
          : { status: "not_found" as const };
      });
    },
    listCampaigns(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => ({
        status: "ready" as const, campaigns: await unit.campaigns.list(),
      }));
    },
    updateCampaignDraft(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.campaigns.updateDraft(input);
        if (result.status === "updated") await audit(unit, input.context,
          "campaign.draft_update", result.campaign.id, result.campaign.updatedAt,
          { version: result.campaign.version,
            countryCount: result.campaign.countryCodes.length,
            languageCount: result.campaign.languageCodes.length,
            concurrencyLimit: result.campaign.concurrencyLimit });
        return result;
      });
    },
    scheduleCampaign(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.campaigns.schedule(input);
        if (result.status === "scheduled") await audit(unit, input.context,
          "campaign.schedule", result.campaign.id, result.campaign.updatedAt,
          { version: result.campaign.version, status: result.campaign.status,
            policyVersion: result.campaign.policyVersion,
            generatedTaskCount: result.generatedTaskCount });
        if (result.status === "blocked" &&
          !("replayed" in result && result.replayed)) await audit(unit, input.context,
          "campaign.schedule", input.campaignId, input.occurredAt,
          { result: "denied", reasonCode: result.reasonCode });
        return result;
      });
    },
  };
}

type Unit = Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0];
async function audit(unit: Unit,
  context: Parameters<typeof createEnterpriseAuditEvent>[0]["context"],
  action: string, resourceId: string, createdAt: string,
  details: Record<string, unknown>) {
  const denied = details.result === "denied";
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context, action,
    resourceType: "campaign", resourceId, result: denied ? "denied" : "completed",
    details: denied ? Object.fromEntries(Object.entries(details).filter(([key]) =>
      key !== "result")) : details, createdAt }));
}
