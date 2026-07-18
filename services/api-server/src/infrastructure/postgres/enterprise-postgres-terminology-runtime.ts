import {
  createEnterpriseAuditEvent,
} from "../../modules/enterprise/enterprise-audit.repository.js";
import {
  createEnterpriseRuntimeContext,
  validateEnterpriseTerminologyResolution,
} from "../../modules/enterprise/enterprise-terminology.js";
import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import {
  withEnterprisePostgresUnitOfWork,
} from "./enterprise-postgres-unit-of-work.js";

type TerminologyRuntime = Required<Pick<EnterpriseRepositoryRuntime,
  | "createTermPack" | "listTermPacks" | "createTermPackVersion"
  | "listTermPackVersions" | "stageTermPackVersion" | "publishTermPackVersion"
  | "createScriptTemplate" | "listScriptTemplates" | "createScriptTemplateVersion"
  | "listScriptTemplateVersions" | "stageScriptTemplateVersion"
  | "publishScriptTemplateVersion" | "resolveTerminologyContext"
>>;

export function createEnterprisePostgresTerminologyRuntime(
  pool: EnterpriseTenantPostgresPool,
): TerminologyRuntime {
  return {
    createTermPack(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.termPacks.createPack(input.termPack);
        if (result.status !== "created") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "term_pack.create",
          resourceType: "term_pack", resourceId: result.termPack.id,
          result: "completed", details: { name: result.termPack.name },
          createdAt: result.termPack.createdAt,
        }));
        return result;
      });
    },
    async listTermPacks(input) {
      const termPacks = await withEnterprisePostgresUnitOfWork(
        pool, input.context, (unit) => unit.termPacks.listPacks(),
      );
      return { status: "ready", termPacks };
    },
    createTermPackVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.termPacks.createVersion(input.termPackVersion);
        if (result.status !== "created") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "term_pack_version.create",
          resourceType: "term_pack_version", resourceId: result.termPackVersion.id,
          result: "completed", details: {
            termPackId: result.termPackVersion.termPackId,
            revision: result.termPackVersion.revision,
          }, createdAt: result.termPackVersion.createdAt,
        }));
        return result;
      });
    },
    async listTermPackVersions(input) {
      const termPackVersions = await withEnterprisePostgresUnitOfWork(
        pool, input.context, (unit) => unit.termPacks.listVersions(input.termPackId),
      );
      return { status: "ready", termPackVersions };
    },
    stageTermPackVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.termPacks.stageVersion(input.content);
        if (result.status !== "staged") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "term_pack_version.review",
          resourceType: "term_pack_version", resourceId: result.termPackVersion.id,
          result: "completed", details: {
            termCount: result.termPackVersion.termCount,
            contentHash: result.termPackVersion.contentHash ?? "",
          }, createdAt: input.content.reviewedAt,
        }));
        return result;
      });
    },
    publishTermPackVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.termPacks.publishVersion(input.publication);
        if (result.status !== "published") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "term_pack_version.publish",
          resourceType: "term_pack_version", resourceId: result.termPackVersion.id,
          result: "completed", details: {
            termPackId: result.termPackVersion.termPackId,
            revision: result.termPackVersion.revision,
            contentHash: result.termPackVersion.contentHash ?? "",
          }, createdAt: result.termPackVersion.publishedAt!,
        }));
        return result;
      });
    },
    createScriptTemplate(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.scriptTemplates.createTemplate(input.scriptTemplate);
        if (result.status !== "created") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "script_template.create",
          resourceType: "script_template", resourceId: result.scriptTemplate.id,
          result: "completed", details: { purpose: result.scriptTemplate.purpose },
          createdAt: result.scriptTemplate.createdAt,
        }));
        return result;
      });
    },
    async listScriptTemplates(input) {
      const scriptTemplates = await withEnterprisePostgresUnitOfWork(
        pool, input.context, (unit) => unit.scriptTemplates.listTemplates(),
      );
      return { status: "ready", scriptTemplates };
    },
    createScriptTemplateVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.scriptTemplates.createVersion(input.scriptTemplateVersion);
        if (result.status !== "created") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "script_template_version.create",
          resourceType: "script_template_version", resourceId: result.scriptTemplateVersion.id,
          result: "completed", details: {
            scriptTemplateId: result.scriptTemplateVersion.scriptTemplateId,
            revision: result.scriptTemplateVersion.revision,
          }, createdAt: result.scriptTemplateVersion.createdAt,
        }));
        return result;
      });
    },
    async listScriptTemplateVersions(input) {
      const scriptTemplateVersions = await withEnterprisePostgresUnitOfWork(
        pool, input.context,
        (unit) => unit.scriptTemplates.listVersions(input.scriptTemplateId),
      );
      return { status: "ready", scriptTemplateVersions };
    },
    stageScriptTemplateVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.scriptTemplates.stageVersion(input.content);
        if (result.status !== "staged") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "script_template_version.review",
          resourceType: "script_template_version",
          resourceId: result.scriptTemplateVersion.id, result: "completed",
          details: { contentHash: result.scriptTemplateVersion.contentHash ?? "" },
          createdAt: input.content.reviewedAt,
        }));
        return result;
      });
    },
    publishScriptTemplateVersion(input) {
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const result = await unit.scriptTemplates.publishVersion(input.publication);
        if (result.status !== "published") return result;
        await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
          context: input.context, action: "script_template_version.publish",
          resourceType: "script_template_version",
          resourceId: result.scriptTemplateVersion.id, result: "completed",
          details: {
            scriptTemplateId: result.scriptTemplateVersion.scriptTemplateId,
            revision: result.scriptTemplateVersion.revision,
            contentHash: result.scriptTemplateVersion.contentHash ?? "",
          }, createdAt: result.scriptTemplateVersion.publishedAt!,
        }));
        return result;
      });
    },
    resolveTerminologyContext(input) {
      const resolution = validateEnterpriseTerminologyResolution(input.resolution);
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        const termPack = await unit.termPacks.resolve(resolution);
        if (!termPack) return { status: "term_pack_not_ready" as const };
        const script = resolution.scriptTemplateId
          ? await unit.scriptTemplates.resolve({
              scriptTemplateId: resolution.scriptTemplateId,
              locale: resolution.targetLocale,
              countryCode: resolution.countryCode,
              productCode: resolution.productCode,
              purpose: resolution.purpose,
              now: resolution.now,
            })
          : null;
        if (resolution.scriptTemplateId && !script) {
          return { status: "script_template_not_ready" as const };
        }
        return {
          status: "ready" as const,
          runtimeContext: createEnterpriseRuntimeContext({
            termPackVersionId: termPack.version.id,
            termContentHash: termPack.contentHash,
            terms: termPack.terms,
            ...(script ? {
              scriptTemplateVersionId: script.version.id,
              scriptContentHash: script.contentHash,
              script: script.content,
            } : {}),
          }),
        };
      });
    },
  };
}
