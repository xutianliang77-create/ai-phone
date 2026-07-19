import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId, requireEnterpriseScope } from
  "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";
import { prepareEnterpriseSupportToolDefinition } from
  "./enterprise-support-tool-registry.js";
import { createEnterpriseTenantContext } from "./enterprise-tenant-context.js";
import { requireTenantRouteDocument } from "./enterprise-tenant-route.routes.js";
import type { TenantRouteService } from "./enterprise-tenant-route.js";

export function registerEnterpriseSupportToolRoutes(
  app: FastifyInstance,
  routeService: TenantRouteService,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/enterprise/v1/support/tools", async (request, reply) => {
    const access = await accessFor(request, reply, runtime, routeService,
      "support:manage", "support.tool_definition.create");
    if (!access) return;
    if (!runtime.createSupportToolDefinition) return postgresRequired(reply);
    const definition = definitionRequest(request.body);
    if (!definition) return invalid(reply, "invalid_support_tool_definition");
    const result = await runtime.createSupportToolDefinition({
      context: tenantContext(access, request), id: randomUUID(), definition,
      createdAt: new Date().toISOString(),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.status(201).send({ definition: result.definition });
  });

  app.get("/enterprise/v1/support/tools", async (request, reply) => {
    const access = await accessFor(request, reply, runtime, routeService,
      "support:read", "support.tool_definition.list");
    if (!access) return;
    if (!runtime.listSupportToolDefinitions) return postgresRequired(reply);
    const result = await runtime.listSupportToolDefinitions({
      context: tenantContext(access, request),
    });
    if (result.status === "storage_required") return postgresRequired(reply);
    return reply.send({ definitions: result.definitions });
  });

  app.post<{ Params: { definitionId: string } }>(
    "/enterprise/v1/support/tools/:definitionId/publish",
    async (request, reply) => {
      const access = await accessFor(request, reply, runtime, routeService,
        "support:manage", "support.tool_definition.publish");
      if (!access) return;
      if (!runtime.publishSupportToolDefinition) return postgresRequired(reply);
      const body = versionRequest(request.body);
      if (!uuid(request.params.definitionId) || !body) {
        return invalid(reply, "invalid_support_tool_publication");
      }
      const result = await runtime.publishSupportToolDefinition({
        context: tenantContext(access, request),
        definitionId: request.params.definitionId,
        expectedVersion: body.expectedVersion,
        publishedAt: new Date().toISOString(),
      });
      return definitionResult(reply, result);
    },
  );

  app.post<{ Params: { definitionId: string } }>(
    "/enterprise/v1/support/tools/:definitionId/retire",
    async (request, reply) => {
      const access = await accessFor(request, reply, runtime, routeService,
        "support:manage", "support.tool_definition.retire");
      if (!access) return;
      if (!runtime.retireSupportToolDefinition) return postgresRequired(reply);
      const body = versionRequest(request.body);
      if (!uuid(request.params.definitionId) || !body) {
        return invalid(reply, "invalid_support_tool_retirement");
      }
      const result = await runtime.retireSupportToolDefinition({
        context: tenantContext(access, request),
        definitionId: request.params.definitionId,
        expectedVersion: body.expectedVersion,
        retiredAt: new Date().toISOString(),
      });
      return definitionResult(reply, result);
    },
  );

  app.post("/internal/enterprise/support-tools/authorize",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.authorizeSupportToolRequest) return postgresRequired(reply);
      const body = authorizationRequest(request.body);
      if (!body) return invalid(reply, "invalid_support_tool_authorization");
      const result = await runtime.authorizeSupportToolRequest({ ...body,
        traceId: enterpriseRequestTraceId(request) });
      if (["authorized", "confirmation_required", "handoff_required"]
        .includes(result.status)) return reply.send(result);
      if (result.status === "invalid_arguments") {
        return invalid(reply, "invalid_support_tool_arguments");
      }
      if (["invalid_ticket", "ticket_expired"].includes(result.status)) {
        return sendError(reply, 403, "support_tool_ticket_rejected",
          "Support tool Worker ticket rejected");
      }
      return sendError(reply, 409, result.status,
        "Support tool authorization rejected");
    });

  app.post("/internal/enterprise/support-tools/execute-read",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.executeSupportReadTool) return postgresRequired(reply);
      const body = readExecutionRequest(request.body);
      if (!body) return invalid(reply, "invalid_support_read_tool_execution");
      const result = await runtime.executeSupportReadTool({ ...body,
        traceId: enterpriseRequestTraceId(request) });
      if (result.status === "completed") return reply.send(result);
      if (result.status === "in_progress") return reply.status(202).send(result);
      if (result.status === "invalid_arguments") {
        return invalid(reply, "invalid_support_read_tool_arguments");
      }
      if (["invalid_ticket", "ticket_expired"].includes(result.status)) {
        return sendError(reply, 403, "support_read_tool_ticket_rejected",
          "Support read tool Worker ticket rejected");
      }
      if (result.status === "not_found") return sendError(reply, 404,
        "support_read_tool_execution_not_found", "Support read execution not found");
      if (result.status === "not_configured") return sendError(reply, 503,
        "support_read_tool_not_configured",
        `Support read tool not configured: ${reason(result, "not_configured")}`);
      if (result.status === "failed") return sendError(reply, 503,
        "support_read_tool_failed",
        `Support read tool failed: ${reason(result, "adapter_failed")}`);
      return sendError(reply, 409, result.status,
        "Support read tool execution rejected");
    });
}

async function accessFor(
  request: FastifyRequest,
  reply: FastifyReply,
  runtime: EnterpriseRepositoryRuntime,
  routeService: TenantRouteService,
  scope: "support:read" | "support:manage",
  action: string,
) {
  const access = await requireEnterpriseScope(request, reply, runtime, scope,
    { action, resourceType: "support_tool_definition" });
  return access && requireTenantRouteDocument(
    request, reply, routeService, access.tenant,
  ) ? access : null;
}

function tenantContext(
  access: NonNullable<Awaited<ReturnType<typeof requireEnterpriseScope>>>,
  request: FastifyRequest,
) {
  return createEnterpriseTenantContext({ tenantId: access.tenant.id,
    actorUserId: access.account.id, actorRole: access.member.role,
    traceId: enterpriseRequestTraceId(request) });
}

function definitionRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["toolName", "description", "riskLevel",
    "requiredScope", "confirmationMode", "inputSchema"])) return null;
  try { return prepareEnterpriseSupportToolDefinition({
    toolName: body.toolName, description: body.description,
    riskLevel: body.riskLevel, requiredScope: body.requiredScope,
    confirmationMode: body.confirmationMode, inputSchema: body.inputSchema,
  }); } catch { return null; }
}

function versionRequest(value: unknown) {
  const body = record(value);
  return body && exact(body, ["expectedVersion"]) &&
    Number.isSafeInteger(body.expectedVersion) && Number(body.expectedVersion) >= 1
    ? { expectedVersion: Number(body.expectedVersion) } : null;
}

function authorizationRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["ticket", "workerCellId", "workerId", "runId",
    "toolName", "idempotencyKey", "arguments"]) ||
    !bounded(body.ticket, 4_096, 64) || !code(body.workerCellId, 128) ||
    !code(body.workerId, 128) || !uuid(body.runId) ||
    !toolCode(body.toolName) || !code(body.idempotencyKey, 160)) return null;
  const args = record(body.arguments);
  if (!args || Buffer.byteLength(JSON.stringify(args)) > 8_192) return null;
  return { ticket: body.ticket, workerCellId: body.workerCellId,
    workerId: body.workerId, runId: body.runId, toolName: body.toolName,
    idempotencyKey: body.idempotencyKey, arguments: args };
}

function readExecutionRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["ticket", "workerCellId", "workerId", "runId",
    "executionId", "arguments"]) || !bounded(body.ticket, 4_096, 64) ||
    !code(body.workerCellId, 128) || !code(body.workerId, 128) ||
    !uuid(body.runId) || !uuid(body.executionId)) return null;
  const args = record(body.arguments);
  if (!args || Buffer.byteLength(JSON.stringify(args)) > 8_192) return null;
  return { ticket: body.ticket, workerCellId: body.workerCellId,
    workerId: body.workerId, runId: body.runId, executionId: body.executionId,
    arguments: args };
}

function definitionResult(reply: FastifyReply, result: { status: string;
  definition?: unknown }) {
  if (result.status === "storage_required") return postgresRequired(reply);
  if (result.status === "not_found") {
    return sendError(reply, 404, "support_tool_definition_not_found",
      "Support tool definition not found");
  }
  if (result.status === "conflict") {
    return sendError(reply, 409, "support_tool_definition_conflict",
      "Support tool definition version conflict");
  }
  return reply.send({ definition: result.definition });
}

function internalAuthorized(request: FastifyRequest) {
  const expected = Buffer.from(process.env.INTERNAL_API_SECRET?.trim() ?? "");
  const authorization = request.headers.authorization;
  const supplied = Buffer.from(authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function bounded(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && Buffer.byteLength(value.trim()) >= min &&
    Buffer.byteLength(value.trim()) <= max;
}
function code(value: unknown, max: number): value is string {
  return typeof value === "string" && Buffer.byteLength(value) <= max &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
function toolCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{1,127}$/.test(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
function invalid(reply: FastifyReply, codeValue: string) {
  return sendError(reply, 400, codeValue, "Invalid Support tool request");
}
function unauthorized(reply: FastifyReply) {
  return sendError(reply, 401, "internal_error", "Unauthorized internal request");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
function reason(value: object, fallback: string) {
  return "reasonCode" in value && typeof value.reasonCode === "string"
    ? value.reasonCode : fallback;
}
