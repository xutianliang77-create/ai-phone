import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type { EnterpriseMarketingConsentRepositoryRuntime } from
  "../../modules/enterprise/enterprise-marketing-consent-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type Runtime = Required<EnterpriseMarketingConsentRepositoryRuntime>;

export function createEnterprisePostgresMarketingConsentRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    registerMarketingConsent(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.marketingConsents.create(input.consent);
        if (result.status === "created") await audit(unit, input.context,
          "campaign.consent_register", result.consent.id, result.consent.createdAt, {
            campaignId: result.consent.campaignId, leadId: result.consent.leadId,
            purpose: result.consent.purpose,
            collectionChannel: result.consent.collectionChannel,
            evidenceObjectId: result.consent.evidence.objectId,
            evidenceSha256: result.consent.evidence.sha256,
            evidenceSizeBytes: result.consent.evidence.sizeBytes,
            consentStatementVersion: result.consent.consentStatementVersion,
          });
        return result;
      });
    },
    listMarketingConsents(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const consents = await unit.marketingConsents.list(
          input.campaignId, input.leadId,
        );
        return consents ? { status: "ready" as const, consents }
          : { status: "not_found" as const };
      });
    },
    resolveMarketingConsentEligibility(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, (unit) =>
        unit.marketingConsents.resolve(
          input.campaignId, input.leadId, input.evaluatedAt,
        ));
    },
    revokeMarketingConsent(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.marketingConsents.revoke(input);
        if (result.status === "revoked") await audit(unit, input.context,
          "campaign.consent_revoke", result.consent.id,
          result.consent.revokedAt!, { campaignId: result.consent.campaignId,
            leadId: result.consent.leadId,
            reason: result.consent.revocationReason,
            cancelledTaskCount: result.cancelledTaskCount,
            version: result.consent.version });
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
  await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({ context, action,
    resourceType: "marketing_consent", resourceId, result: "completed",
    details, createdAt }));
}
