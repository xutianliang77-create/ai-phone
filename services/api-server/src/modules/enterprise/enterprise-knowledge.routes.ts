import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseKnowledgeSourceType } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireEnterpriseScope } from "./enterprise-auth.js";
import {
  prepareEnterpriseKnowledgeChunks,
  validateEnterpriseKnowledgeDimensions,
  validateEnterpriseKnowledgePublishTime,
  validateEnterpriseKnowledgeSearch,
} from "./enterprise-knowledge.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";

export async function registerEnterpriseKnowledgeRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/enterprise/v1/knowledge/sources", async (request, reply) => {
    const access = await requireKnowledgeAccess(
      request, reply, runtime, routeService, "knowledge:publish", "knowledge_source.create",
    );
    if (!access) return;
    if (!runtime.createKnowledgeSource) return postgresRequired(reply);
    const body = parseSource(request.body);
    if (!body) return invalid(reply, "invalid_knowledge_source");
    if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
    const createdAt = new Date().toISOString();
    const result = await runtime.createKnowledgeSource({
      context: tenantContext(access, request.id),
      source: { id: randomUUID(), ...body.source, createdAt },
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    if (result.status === "name_conflict") {
      return sendError(reply, 409, "knowledge_source_name_conflict", "Source name exists");
    }
    return reply.status(201).send({ source: result.source });
  });

  app.get("/enterprise/v1/knowledge/sources", async (request, reply) => {
    const access = await requireKnowledgeAccess(
      request, reply, runtime, routeService, "knowledge:read", "knowledge_source.list",
    );
    if (!access) return;
    if (!runtime.listKnowledgeSources) return postgresRequired(reply);
    const result = await runtime.listKnowledgeSources({
      context: tenantContext(access, request.id),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.send({ sources: result.sources });
  });

  app.post<{ Params: { sourceId: string } }>(
    "/enterprise/v1/knowledge/sources/:sourceId/versions",
    async (request, reply) => {
      const access = await requireKnowledgeAccess(
        request, reply, runtime, routeService, "knowledge:publish", "knowledge_version.create",
      );
      if (!access) return;
      if (!runtime.createKnowledgeVersion) return postgresRequired(reply);
      const sourceId = uuid(request.params.sourceId);
      if (!sourceId) return invalid(reply, "invalid_knowledge_source_id");
      const body = parseVersion(request.body);
      if (!body) return invalid(reply, "invalid_knowledge_version");
      if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
      const result = await runtime.createKnowledgeVersion({
        context: tenantContext(access, request.id),
        knowledgeVersion: {
          id: randomUUID(), sourceId,
          ...body.dimensions, createdAt: new Date().toISOString(),
        },
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "source_not_found") {
        return sendError(reply, 404, "knowledge_source_not_found", "Source not found");
      }
      return reply.status(201).send({ knowledgeVersion: result.knowledgeVersion });
    },
  );

  app.get<{ Params: { sourceId: string } }>(
    "/enterprise/v1/knowledge/sources/:sourceId/versions",
    async (request, reply) => {
      const access = await requireKnowledgeAccess(
        request, reply, runtime, routeService, "knowledge:read", "knowledge_version.list",
      );
      if (!access) return;
      if (!runtime.listKnowledgeVersions) return postgresRequired(reply);
      const sourceId = uuid(request.params.sourceId);
      if (!sourceId) return invalid(reply, "invalid_knowledge_source_id");
      const result = await runtime.listKnowledgeVersions({
        context: tenantContext(access, request.id), sourceId,
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      return reply.send({ knowledgeVersions: result.knowledgeVersions });
    },
  );

  app.put<{ Params: { versionId: string } }>(
    "/enterprise/v1/knowledge/versions/:versionId/chunks",
    async (request, reply) => {
      const access = await requireKnowledgeAccess(
        request, reply, runtime, routeService, "knowledge:publish", "knowledge_version.stage",
      );
      if (!access) return;
      if (!runtime.stageKnowledgeChunks) return postgresRequired(reply);
      const versionId = uuid(request.params.versionId);
      if (!versionId) return invalid(reply, "invalid_knowledge_version_id");
      const body = parseChunks(request.body);
      if (!body) return invalid(reply, "invalid_knowledge_chunks");
      if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
      const result = await runtime.stageKnowledgeChunks({
        context: tenantContext(access, request.id),
        chunks: {
          versionId,
          expectedVersion: body.expectedVersion,
          chunks: body.chunks,
          reviewedAt: new Date().toISOString(),
        },
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return versionNotFound(reply);
      if (result.status !== "staged") return versionConflict(reply, result.status);
      return reply.send({ knowledgeVersion: result.knowledgeVersion });
    },
  );

  app.post<{ Params: { versionId: string } }>(
    "/enterprise/v1/knowledge/versions/:versionId/publish",
    async (request, reply) => {
      const access = await requireKnowledgeAccess(
        request, reply, runtime, routeService, "knowledge:publish", "knowledge_version.publish",
      );
      if (!access) return;
      if (!runtime.publishKnowledgeVersion) return postgresRequired(reply);
      const versionId = uuid(request.params.versionId);
      if (!versionId) return invalid(reply, "invalid_knowledge_version_id");
      const now = new Date().toISOString();
      const body = parsePublish(request.body, now);
      if (!body) return invalid(reply, "invalid_knowledge_publication");
      if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
      const result = await runtime.publishKnowledgeVersion({
        context: tenantContext(access, request.id),
        publication: {
          versionId,
          expectedVersion: body.expectedVersion,
          effectiveFrom: body.effectiveFrom,
          ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
          publishedAt: now,
        },
      });
      if (result.status === "storage_required") return postgresRequired(reply);
      if (result.status === "not_found") return versionNotFound(reply);
      if (result.status !== "published") return versionConflict(reply, result.status);
      return reply.send({ knowledgeVersion: result.knowledgeVersion });
    },
  );

  app.post("/enterprise/v1/knowledge/search", async (request, reply) => {
    const access = await requireKnowledgeAccess(
      request, reply, runtime, routeService, "knowledge:read", "knowledge.search",
    );
    if (!access) return;
    if (!runtime.searchKnowledge) return postgresRequired(reply);
    const body = parseSearch(request.body);
    if (!body) return invalid(reply, "invalid_knowledge_search");
    if (!tenantMatches(body.tenantId, access.tenant.id)) return mismatch(reply);
    const result = await runtime.searchKnowledge({
      context: tenantContext(access, request.id),
      search: { ...body.search, now: new Date().toISOString() },
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.send({ results: result.results });
  });
}

async function requireKnowledgeAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "knowledge:read" | "knowledge:publish",
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope, {
    action, resourceType: "knowledge",
  });
  if (!access || !requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  )) return null;
  return access;
}

function tenantContext(
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
  traceId: unknown,
) {
  return createEnterpriseTenantContext({
    tenantId: access.tenant.id, actorUserId: access.account.id,
    actorRole: access.member.role, traceId: String(traceId),
  });
}

function parseSource(value: unknown) {
  const body = object(value);
  const name = bounded(body?.name, 200);
  const sourceType = knowledgeSourceTypes.includes(
    body?.sourceType as EnterpriseKnowledgeSourceType,
  ) ? body?.sourceType as EnterpriseKnowledgeSourceType : null;
  if (!body || !name || !sourceType || !optionalTenant(body.tenantId)) return null;
  return { tenantId: body.tenantId as string | undefined, source: { name, sourceType } };
}

const knowledgeSourceTypes = [
  "upload", "url", "text", "integration",
] as const satisfies readonly EnterpriseKnowledgeSourceType[];

function parseVersion(value: unknown) {
  const body = object(value);
  if (!body || !optionalTenant(body.tenantId)) return null;
  try {
    const dimensions = validateEnterpriseKnowledgeDimensions({
      locale: text(body.locale), countryCode: text(body.countryCode),
      productCode: text(body.productCode),
    });
    return { tenantId: body.tenantId as string | undefined, dimensions };
  } catch { return null; }
}

function parseChunks(value: unknown) {
  const body = object(value);
  if (!body || !optionalTenant(body.tenantId) || !positiveInt(body.expectedVersion) ||
    !Array.isArray(body.chunks)) return null;
  const chunks = body.chunks.map((item) => {
    const record = object(item);
    return { blockId: record?.blockId, content: record?.content };
  });
  if (chunks.some(({ blockId, content }) =>
    typeof blockId !== "string" || typeof content !== "string"
  )) return null;
  try {
    prepareEnterpriseKnowledgeChunks(chunks as Array<{ blockId: string; content: string }>);
    return {
      tenantId: body.tenantId as string | undefined,
      expectedVersion: Number(body.expectedVersion),
      chunks: chunks as Array<{ blockId: string; content: string }>,
    };
  } catch { return null; }
}

function parsePublish(value: unknown, now: string) {
  const body = object(value);
  if (!body || !optionalTenant(body.tenantId) || !positiveInt(body.expectedVersion) ||
    (body.effectiveFrom !== undefined && typeof body.effectiveFrom !== "string") ||
    (body.expiresAt !== undefined && typeof body.expiresAt !== "string")) return null;
  const publication = {
    expectedVersion: Number(body.expectedVersion),
    effectiveFrom: body.effectiveFrom as string | undefined ?? now,
    ...(body.expiresAt !== undefined
      ? { expiresAt: body.expiresAt as string }
      : {}),
    publishedAt: now,
  };
  try {
    validateEnterpriseKnowledgePublishTime(publication);
    return { tenantId: body.tenantId as string | undefined, ...publication };
  } catch { return null; }
}

function parseSearch(value: unknown) {
  const body = object(value);
  if (!body || !optionalTenant(body.tenantId)) return null;
  if (typeof body.query !== "string" || typeof body.locale !== "string" ||
    typeof body.countryCode !== "string" || typeof body.productCode !== "string" ||
    (body.limit !== undefined && typeof body.limit !== "number")) return null;
  const search = {
    query: body.query, locale: body.locale,
    countryCode: body.countryCode, productCode: body.productCode,
    limit: body.limit === undefined ? 10 : body.limit, now: new Date().toISOString(),
  };
  try {
    return {
      tenantId: body.tenantId as string | undefined,
      search: validateEnterpriseKnowledgeSearch(search),
    };
  } catch { return null; }
}

function object(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}
function bounded(value: unknown, max: number) {
  return typeof value === "string" && value.trim() && Buffer.byteLength(value.trim()) <= max
    ? value.trim() : null;
}
function optionalTenant(value: unknown) {
  return value === undefined || typeof value === "string";
}
function positiveInt(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}
function uuid(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}
function tenantMatches(value: string | undefined, tenantId: string) {
  return value === undefined || value === tenantId;
}
function mismatch(reply: FastifyReply) {
  return sendError(reply, 409, "tenant_context_mismatch", "Tenant context mismatch");
}
function invalid(reply: FastifyReply, code: string) {
  return sendError(reply, 400, code, "Invalid enterprise knowledge request");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required", "PostgreSQL enterprise runtime required");
}
function versionNotFound(reply: FastifyReply) {
  return sendError(reply, 404, "knowledge_version_not_found", "Knowledge version not found");
}
function versionConflict(reply: FastifyReply, status: string) {
  return sendError(reply, 409, `knowledge_${status}`, "Knowledge version conflict");
}
