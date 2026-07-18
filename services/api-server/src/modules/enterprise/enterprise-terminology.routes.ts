import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  EnterpriseTermEntryDto,
  EnterpriseTerminologyPurpose,
} from "@translation/contracts";
import {
  prepareEnterpriseTerms,
  validateEnterpriseTerminologyResolution,
  validateEnterpriseTermDimensions,
} from "./enterprise-terminology.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";
import {
  boundedText,
  contentError,
  enterpriseContentContext,
  objectValue,
  optionalTenant,
  parseEnterprisePublication,
  positiveInteger,
  postgresContentRequired,
  requireEnterpriseContentAccess,
  uuidValue,
  validateEnterpriseBodyTenant,
  versionConflict,
} from "./enterprise-content-route-support.js";

export async function registerEnterpriseTerminologyRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/enterprise/v1/terminology/packs", async (request, reply) => {
    const access = await requireEnterpriseContentAccess(
      request, reply, runtime, routeService, "knowledge:publish", "term_pack.create",
    );
    if (!access) return;
    if (!runtime.createTermPack) return postgresContentRequired(reply);
    const body = parsePack(request.body);
    if (!body) return contentError(reply, 400, "invalid_term_pack");
    if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
    const result = await runtime.createTermPack({
      context: enterpriseContentContext(access, request.id),
      termPack: { id: randomUUID(), name: body.name, createdAt: new Date().toISOString() },
    });
    if (result.status === "storage_required") return postgresContentRequired(reply);
    if (result.status === "name_conflict") {
      return contentError(reply, 409, "term_pack_name_conflict", "Term pack name exists");
    }
    return reply.status(201).send({ termPack: result.termPack });
  });

  app.get("/enterprise/v1/terminology/packs", async (request, reply) => {
    const access = await requireEnterpriseContentAccess(
      request, reply, runtime, routeService, "knowledge:read", "term_pack.list",
    );
    if (!access) return;
    if (!runtime.listTermPacks) return postgresContentRequired(reply);
    const result = await runtime.listTermPacks({
      context: enterpriseContentContext(access, request.id),
    });
    if (result.status === "storage_required") return postgresContentRequired(reply);
    return reply.send({ termPacks: result.termPacks });
  });

  app.post<{ Params: { packId: string } }>(
    "/enterprise/v1/terminology/packs/:packId/versions",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService,
        "knowledge:publish", "term_pack_version.create",
      );
      if (!access) return;
      if (!runtime.createTermPackVersion) return postgresContentRequired(reply);
      const termPackId = uuidValue(request.params.packId);
      const body = parsePackVersion(request.body);
      if (!termPackId || !body) return contentError(reply, 400, "invalid_term_pack_version");
      if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
      const result = await runtime.createTermPackVersion({
        context: enterpriseContentContext(access, request.id),
        termPackVersion: {
          id: randomUUID(), termPackId, dimensions: body.dimensions,
          createdAt: new Date().toISOString(),
        },
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      if (result.status === "pack_not_found") {
        return contentError(reply, 404, "term_pack_not_found", "Term pack not found");
      }
      return reply.status(201).send({ termPackVersion: result.termPackVersion });
    },
  );

  app.get<{ Params: { packId: string } }>(
    "/enterprise/v1/terminology/packs/:packId/versions",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService, "knowledge:read", "term_pack_version.list",
      );
      if (!access) return;
      if (!runtime.listTermPackVersions) return postgresContentRequired(reply);
      const termPackId = uuidValue(request.params.packId);
      if (!termPackId) return contentError(reply, 400, "invalid_term_pack_id");
      const result = await runtime.listTermPackVersions({
        context: enterpriseContentContext(access, request.id), termPackId,
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      return reply.send({ termPackVersions: result.termPackVersions });
    },
  );

  app.put<{ Params: { versionId: string } }>(
    "/enterprise/v1/terminology/pack-versions/:versionId/content",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService, "knowledge:publish", "term_pack_version.review",
      );
      if (!access) return;
      if (!runtime.stageTermPackVersion) return postgresContentRequired(reply);
      const versionId = uuidValue(request.params.versionId);
      const body = parsePackContent(request.body);
      if (!versionId || !body) return contentError(reply, 400, "invalid_term_pack_content");
      if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
      const result = await runtime.stageTermPackVersion({
        context: enterpriseContentContext(access, request.id),
        content: {
          versionId, expectedVersion: body.expectedVersion,
          terms: body.terms, reviewedAt: new Date().toISOString(),
        },
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      if (result.status !== "staged") return versionConflict(reply, "term_pack_version", result.status);
      return reply.send({ termPackVersion: result.termPackVersion });
    },
  );

  app.post<{ Params: { versionId: string } }>(
    "/enterprise/v1/terminology/pack-versions/:versionId/publish",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService, "knowledge:publish", "term_pack_version.publish",
      );
      if (!access) return;
      if (!runtime.publishTermPackVersion) return postgresContentRequired(reply);
      const versionId = uuidValue(request.params.versionId);
      const body = parseEnterprisePublication(request.body, new Date().toISOString());
      if (!versionId || !body) return contentError(reply, 400, "invalid_term_pack_publication");
      if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
      const result = await runtime.publishTermPackVersion({
        context: enterpriseContentContext(access, request.id),
        publication: { versionId, ...body },
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      if (result.status !== "published") {
        return versionConflict(reply, "term_pack_version", result.status);
      }
      return reply.send({ termPackVersion: result.termPackVersion });
    },
  );

  app.post("/enterprise/v1/runtime-terminology/resolve", async (request, reply) => {
    const access = await requireEnterpriseContentAccess(
      request, reply, runtime, routeService, "knowledge:read", "terminology_context.resolve",
    );
    if (!access) return;
    if (!runtime.resolveTerminologyContext) return postgresContentRequired(reply);
    const body = parseResolution(request.body);
    if (!body) return contentError(reply, 400, "invalid_terminology_resolution");
    if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
    const result = await runtime.resolveTerminologyContext({
      context: enterpriseContentContext(access, request.id), resolution: body.resolution,
    });
    if (result.status === "storage_required") return postgresContentRequired(reply);
    if (result.status !== "ready") {
      return contentError(reply, 409, result.status, "Published terminology is not ready");
    }
    return reply.send({ runtimeContext: result.runtimeContext });
  });
}

function parsePack(value: unknown) {
  const body = objectValue(value);
  const name = boundedText(body?.name, 200);
  return body && name && optionalTenant(body.tenantId)
    ? { tenantId: body.tenantId as string | undefined, name } : null;
}

function parsePackVersion(value: unknown) {
  const body = objectValue(value);
  if (!body || !optionalTenant(body.tenantId)) return null;
  try {
    return {
      tenantId: body.tenantId as string | undefined,
      dimensions: validateEnterpriseTermDimensions({
        sourceLocale: String(body.sourceLocale ?? ""),
        targetLocale: String(body.targetLocale ?? ""),
        countryCode: String(body.countryCode ?? ""),
        productCode: String(body.productCode ?? ""),
        usageScope: body.usageScope as EnterpriseTerminologyPurpose,
      }),
    };
  } catch { return null; }
}

function parsePackContent(value: unknown) {
  const body = objectValue(value);
  if (!body || !optionalTenant(body.tenantId) || !positiveInteger(body.expectedVersion) ||
    !Array.isArray(body.terms)) return null;
  try {
    const prepared = prepareEnterpriseTerms(body.terms as EnterpriseTermEntryDto[]);
    return {
      tenantId: body.tenantId as string | undefined,
      expectedVersion: Number(body.expectedVersion), terms: prepared.terms,
    };
  } catch { return null; }
}

function parseResolution(value: unknown) {
  const body = objectValue(value);
  if (!body || !optionalTenant(body.tenantId) || typeof body.termPackId !== "string" ||
    (body.scriptTemplateId !== undefined && typeof body.scriptTemplateId !== "string")) return null;
  try {
    const resolution = validateEnterpriseTerminologyResolution({
      termPackId: uuidValue(body.termPackId) ?? "",
      ...(body.scriptTemplateId === undefined ? {} : {
        scriptTemplateId: uuidValue(body.scriptTemplateId) ?? "",
      }),
      sourceLocale: String(body.sourceLocale ?? ""),
      targetLocale: String(body.targetLocale ?? ""),
      countryCode: String(body.countryCode ?? ""),
      productCode: String(body.productCode ?? ""),
      purpose: body.purpose as "marketing" | "support" | "meeting",
      now: new Date().toISOString(),
    });
    if (!resolution.termPackId || body.scriptTemplateId && !resolution.scriptTemplateId) return null;
    return { tenantId: body.tenantId as string | undefined, resolution };
  } catch { return null; }
}
