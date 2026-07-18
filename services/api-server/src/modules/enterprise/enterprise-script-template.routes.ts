import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EnterpriseTerminologyPurpose } from "@translation/contracts";
import {
  prepareEnterpriseScriptContent,
  validateEnterpriseScriptDimensions,
  validateEnterpriseScriptPurpose,
} from "./enterprise-script-template.js";
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

export async function registerEnterpriseScriptTemplateRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/enterprise/v1/script-templates", async (request, reply) => {
    const access = await requireEnterpriseContentAccess(
      request, reply, runtime, routeService, "knowledge:publish", "script_template.create",
    );
    if (!access) return;
    if (!runtime.createScriptTemplate) return postgresContentRequired(reply);
    const body = parseTemplate(request.body);
    if (!body) return contentError(reply, 400, "invalid_script_template");
    if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
    const result = await runtime.createScriptTemplate({
      context: enterpriseContentContext(access, request.id),
      scriptTemplate: {
        id: randomUUID(), name: body.name, purpose: body.purpose,
        createdAt: new Date().toISOString(),
      },
    });
    if (result.status === "storage_required") return postgresContentRequired(reply);
    if (result.status === "name_conflict") {
      return contentError(reply, 409, "script_template_name_conflict", "Script name exists");
    }
    return reply.status(201).send({ scriptTemplate: result.scriptTemplate });
  });

  app.get("/enterprise/v1/script-templates", async (request, reply) => {
    const access = await requireEnterpriseContentAccess(
      request, reply, runtime, routeService, "knowledge:read", "script_template.list",
    );
    if (!access) return;
    if (!runtime.listScriptTemplates) return postgresContentRequired(reply);
    const result = await runtime.listScriptTemplates({
      context: enterpriseContentContext(access, request.id),
    });
    if (result.status === "storage_required") return postgresContentRequired(reply);
    return reply.send({ scriptTemplates: result.scriptTemplates });
  });

  app.post<{ Params: { templateId: string } }>(
    "/enterprise/v1/script-templates/:templateId/versions",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService,
        "knowledge:publish", "script_template_version.create",
      );
      if (!access) return;
      if (!runtime.createScriptTemplateVersion) return postgresContentRequired(reply);
      const scriptTemplateId = uuidValue(request.params.templateId);
      const body = parseTemplateVersion(request.body);
      if (!scriptTemplateId || !body) {
        return contentError(reply, 400, "invalid_script_template_version");
      }
      if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
      const result = await runtime.createScriptTemplateVersion({
        context: enterpriseContentContext(access, request.id),
        scriptTemplateVersion: {
          id: randomUUID(), scriptTemplateId, ...body.dimensions,
          createdAt: new Date().toISOString(),
        },
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      if (result.status === "template_not_found") {
        return contentError(reply, 404, "script_template_not_found", "Script not found");
      }
      return reply.status(201).send({ scriptTemplateVersion: result.scriptTemplateVersion });
    },
  );

  app.get<{ Params: { templateId: string } }>(
    "/enterprise/v1/script-templates/:templateId/versions",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService, "knowledge:read", "script_template_version.list",
      );
      if (!access) return;
      if (!runtime.listScriptTemplateVersions) return postgresContentRequired(reply);
      const scriptTemplateId = uuidValue(request.params.templateId);
      if (!scriptTemplateId) return contentError(reply, 400, "invalid_script_template_id");
      const result = await runtime.listScriptTemplateVersions({
        context: enterpriseContentContext(access, request.id), scriptTemplateId,
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      return reply.send({ scriptTemplateVersions: result.scriptTemplateVersions });
    },
  );

  app.put<{ Params: { versionId: string } }>(
    "/enterprise/v1/script-template-versions/:versionId/content",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService,
        "knowledge:publish", "script_template_version.review",
      );
      if (!access) return;
      if (!runtime.stageScriptTemplateVersion) return postgresContentRequired(reply);
      const versionId = uuidValue(request.params.versionId);
      const body = parseTemplateContent(request.body);
      if (!versionId || !body) return contentError(reply, 400, "invalid_script_content");
      if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
      const result = await runtime.stageScriptTemplateVersion({
        context: enterpriseContentContext(access, request.id),
        content: {
          versionId, expectedVersion: body.expectedVersion,
          content: body.content, reviewedAt: new Date().toISOString(),
        },
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      if (result.status !== "staged") {
        return versionConflict(reply, "script_template_version", result.status);
      }
      return reply.send({ scriptTemplateVersion: result.scriptTemplateVersion });
    },
  );

  app.post<{ Params: { versionId: string } }>(
    "/enterprise/v1/script-template-versions/:versionId/publish",
    async (request, reply) => {
      const access = await requireEnterpriseContentAccess(
        request, reply, runtime, routeService,
        "knowledge:publish", "script_template_version.publish",
      );
      if (!access) return;
      if (!runtime.publishScriptTemplateVersion) return postgresContentRequired(reply);
      const versionId = uuidValue(request.params.versionId);
      const body = parseEnterprisePublication(request.body, new Date().toISOString());
      if (!versionId || !body) return contentError(reply, 400, "invalid_script_publication");
      if (!validateEnterpriseBodyTenant(reply, body.tenantId, access.tenant.id)) return;
      const result = await runtime.publishScriptTemplateVersion({
        context: enterpriseContentContext(access, request.id),
        publication: { versionId, ...body },
      });
      if (result.status === "storage_required") return postgresContentRequired(reply);
      if (result.status !== "published") {
        return versionConflict(reply, "script_template_version", result.status);
      }
      return reply.send({ scriptTemplateVersion: result.scriptTemplateVersion });
    },
  );
}

function parseTemplate(value: unknown) {
  const body = objectValue(value);
  const name = boundedText(body?.name, 200);
  if (!body || !name || !optionalTenant(body.tenantId)) return null;
  try {
    return {
      tenantId: body.tenantId as string | undefined, name,
      purpose: validateEnterpriseScriptPurpose(body.purpose),
    };
  } catch { return null; }
}

function parseTemplateVersion(value: unknown) {
  const body = objectValue(value);
  if (!body || !optionalTenant(body.tenantId)) return null;
  try {
    return {
      tenantId: body.tenantId as string | undefined,
      dimensions: validateEnterpriseScriptDimensions({
        locale: String(body.locale ?? ""), countryCode: String(body.countryCode ?? ""),
        productCode: String(body.productCode ?? ""),
      }),
    };
  } catch { return null; }
}

function parseTemplateContent(value: unknown) {
  const body = objectValue(value);
  if (!body || !optionalTenant(body.tenantId) || !positiveInteger(body.expectedVersion)) return null;
  try {
    const content = prepareEnterpriseScriptContent({
      promptText: String(body.promptText ?? ""),
      requiredPhrases: body.requiredPhrases as string[],
      prohibitedPhrases: body.prohibitedPhrases as string[],
      variables: body.variables as string[],
    });
    return {
      tenantId: body.tenantId as string | undefined,
      expectedVersion: Number(body.expectedVersion), content,
    };
  } catch { return null; }
}
