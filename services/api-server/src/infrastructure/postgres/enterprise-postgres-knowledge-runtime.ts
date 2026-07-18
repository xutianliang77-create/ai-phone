import { createEnterpriseAuditEvent } from
  "../../modules/enterprise/enterprise-audit.repository.js";
import type {
  EnterpriseRepositoryRuntime,
} from "../../modules/enterprise/enterprise-repository-runtime.js";
import type {
  EnterpriseTenantPostgresPool,
} from "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";

type KnowledgeRuntime = Required<Pick<EnterpriseRepositoryRuntime,
  | "createKnowledgeSource"
  | "listKnowledgeSources"
  | "createKnowledgeVersion"
  | "listKnowledgeVersions"
  | "stageKnowledgeChunks"
  | "publishKnowledgeVersion"
  | "searchKnowledge"
>>;

export function createEnterprisePostgresKnowledgeRuntime(
  pool: EnterpriseTenantPostgresPool,
): KnowledgeRuntime {
  return {
    createKnowledgeSource(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.knowledge.createSource(input.source);
          if (result.status !== "created") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "knowledge_source.create",
            resourceType: "knowledge_source",
            resourceId: result.source.id,
            result: "completed",
            details: { sourceType: result.source.sourceType },
            createdAt: result.source.createdAt,
          }));
          return result;
        },
      );
    },
    async listKnowledgeSources(input) {
      const sources = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.knowledge.listSources(),
      );
      return { status: "ready", sources };
    },
    createKnowledgeVersion(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.knowledge.createVersion(input.knowledgeVersion);
          if (result.status !== "created") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "knowledge_version.create",
            resourceType: "knowledge_version",
            resourceId: result.knowledgeVersion.id,
            result: "completed",
            details: {
              sourceId: result.knowledgeVersion.sourceId,
              revision: result.knowledgeVersion.revision,
            },
            createdAt: result.knowledgeVersion.createdAt,
          }));
          return result;
        },
      );
    },
    async listKnowledgeVersions(input) {
      const knowledgeVersions = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.knowledge.listVersions(input.sourceId),
      );
      return { status: "ready", knowledgeVersions };
    },
    stageKnowledgeChunks(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.knowledge.stageChunks(input.chunks);
          if (result.status !== "staged") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "knowledge_version.review",
            resourceType: "knowledge_version",
            resourceId: result.knowledgeVersion.id,
            result: "completed",
            details: {
              chunkCount: result.knowledgeVersion.chunkCount,
              contentHash: result.knowledgeVersion.contentHash ?? "",
            },
            createdAt: input.chunks.reviewedAt,
          }));
          return result;
        },
      );
    },
    publishKnowledgeVersion(input) {
      return withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        async (unit) => {
          const result = await unit.knowledge.publish(input.publication);
          if (result.status !== "published") return result;
          await unit.tenant.appendAuditEvent(createEnterpriseAuditEvent({
            context: input.context,
            action: "knowledge_version.publish",
            resourceType: "knowledge_version",
            resourceId: result.knowledgeVersion.id,
            result: "completed",
            details: {
              sourceId: result.knowledgeVersion.sourceId,
              revision: result.knowledgeVersion.revision,
              contentHash: result.knowledgeVersion.contentHash ?? "",
            },
            createdAt: result.knowledgeVersion.publishedAt!,
          }));
          return result;
        },
      );
    },
    async searchKnowledge(input) {
      const results = await withEnterprisePostgresUnitOfWork(
        pool,
        input.context,
        (unit) => unit.knowledge.search(input.search),
      );
      return { status: "ready", results };
    },
  };
}
