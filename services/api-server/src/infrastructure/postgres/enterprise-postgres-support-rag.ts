import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import { enterpriseSupportRagResponse } from
  "../../modules/enterprise/enterprise-support-rag.js";
import type { EnterpriseSupportRepositoryRuntime } from
  "../../modules/enterprise/enterprise-support-runtime.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type ResolveSupportKnowledgeInput = Parameters<
  NonNullable<EnterpriseSupportRepositoryRuntime["resolveSupportKnowledge"]>
>[0];

const searchableStatuses = new Set([
  "waiting", "ai_active", "handoff_requested", "human_active",
]);

export function resolveEnterprisePostgresSupportKnowledge(
  pool: EnterpriseTenantPostgresPool,
  input: ResolveSupportKnowledgeInput,
) {
  return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
    const session = await unit.support.findSession(input.sessionId);
    if (!session) return { status: "not_found" as const };
    if (!searchableStatuses.has(session.status)) {
      return { status: "not_active" as const };
    }
    const results = await unit.knowledge.search(input.search);
    const resolution = enterpriseSupportRagResponse({
      sessionId: session.id,
      locale: input.search.locale,
      results,
    });
    await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
      context: input.context,
      action: "support.rag.search",
      resourceType: "support_session",
      resourceId: session.id,
      result: "completed",
      details: {
        locale: input.search.locale,
        countryCode: input.search.countryCode,
        productCode: input.search.productCode,
        resultCount: results.length,
      },
      createdAt: input.search.now,
    }));
    for (const item of results) {
      await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
        context: input.context,
        action: "support.rag.evidence",
        resourceType: "support_session",
        resourceId: session.id,
        result: "completed",
        details: {
          knowledgeVersionId: item.knowledgeVersionId,
          sourceId: item.sourceId,
          revision: item.revision,
          blockId: item.blockId,
          contentHash: item.contentHash,
        },
        createdAt: input.search.now,
      }));
    }
    return { status: "ready" as const, resolution };
  });
}
