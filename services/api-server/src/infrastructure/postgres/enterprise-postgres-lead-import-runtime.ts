import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseLeadImportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-lead-import-runtime.js";
import { loadEnterpriseLeadPhoneKeyring } from
  "../../modules/enterprise/enterprise-lead-phone.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseLeadImportRepositoryRuntime>;

export function createEnterprisePostgresLeadImportRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  const keyring = loadEnterpriseLeadPhoneKeyring();
  return {
    importCampaignLeads(input) {
      if (!keyring) return Promise.resolve({ status: "protection_required" as const });
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.leadImports.importBatch({ ...input, keyring });
        if (result.status === "committed") await audit(unit, input.context,
          "campaign.leads_import", result.batch.id, result.batch.committedAt, {
            campaignId: result.batch.campaignId, sourceKind: result.batch.sourceKind,
            totalRows: result.batch.totalRows, createdCount: result.batch.createdCount,
            linkedCount: result.batch.linkedCount,
            duplicateCount: result.batch.duplicateCount,
          });
        if (result.status === "rejected") await audit(unit, input.context,
          "campaign.leads_import", input.campaignId, input.occurredAt, {
            result: "denied", totalRows: result.totalRows,
            errorCodes: [...new Set(result.errors.map((item) => item.code))].sort(),
          });
        return result;
      });
    },
    listCampaignLeads(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        return { status: "ready" as const,
          leads: await unit.leadImports.listLeads(input.campaignId) };
      });
    },
    listLeadImportBatches(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        if (!await unit.campaigns.find(input.campaignId)) {
          return { status: "not_found" as const };
        }
        return { status: "ready" as const,
          batches: await unit.leadImports.listBatches(input.campaignId) };
      });
    },
    rollbackLeadImportBatch(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.leadImports.rollback(input);
        if (result.status === "rolled_back") await audit(unit, input.context,
          "campaign.leads_import_rollback", result.batch.id,
          result.batch.rolledBackAt!, { campaignId: result.batch.campaignId,
            totalRows: result.batch.totalRows, version: result.batch.version });
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
    resourceType: "lead_import_batch", resourceId,
    result: denied ? "denied" : "completed",
    details: denied ? Object.fromEntries(Object.entries(details).filter(([key]) =>
      key !== "result")) : details, createdAt }));
}
