import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId } from "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";

export function registerEnterpriseSupportWriteToolRoutes(
  app: FastifyInstance,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/internal/enterprise/support-tools/prepare-write-confirmation",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.prepareSupportWriteConfirmation) return postgresRequired(reply);
      const body = prepareRequest(request.body);
      if (!body) return invalid(reply, "invalid_support_write_confirmation");
      const result = await runtime.prepareSupportWriteConfirmation({ ...body,
        traceId: enterpriseRequestTraceId(request) });
      if (result.status === "confirmation_required") return reply.send(result);
      return rejected(reply, result, "confirmation");
    });

  app.post("/internal/enterprise/support-tools/confirm-write",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.confirmSupportWriteTool) return postgresRequired(reply);
      const body = confirmRequest(request.body);
      if (!body) return invalid(reply, "invalid_support_write_decision");
      const result = await runtime.confirmSupportWriteTool({ ...body,
        traceId: enterpriseRequestTraceId(request) });
      if (result.status === "processing") return reply.status(202).send(result);
      if (["rejected", "completed", "failed"].includes(result.status)) {
        return reply.send(result);
      }
      if (result.status === "confirmation_unrecognized") {
        return invalid(reply, "support_write_confirmation_unrecognized");
      }
      return rejected(reply, result, "decision");
    });
}

function prepareRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["ticket", "workerCellId", "workerId", "runId",
    "executionId", "locale", "arguments"]) || !worker(body) ||
    !uuid(body.executionId) || !locale(body.locale)) return null;
  const args = argumentsValue(body.arguments);
  return args ? { ...workerValue(body), executionId: body.executionId,
    locale: body.locale, arguments: args } : null;
}

function confirmRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["ticket", "workerCellId", "workerId", "runId",
    "executionId", "confirmationId", "turnId", "customerText", "arguments"]) ||
    !worker(body) || !uuid(body.executionId) || !uuid(body.confirmationId) ||
    !uuid(body.turnId) || !bounded(body.customerText, 160)) return null;
  const args = argumentsValue(body.arguments);
  return args ? { ...workerValue(body), executionId: body.executionId,
    confirmationId: body.confirmationId, turnId: body.turnId,
    customerText: body.customerText, arguments: args } : null;
}

function rejected(reply: FastifyReply, result: { status: string;
  reasonCode?: string }, phase: string) {
  if (["invalid_ticket", "ticket_expired"].includes(result.status)) {
    return sendError(reply, 403, "support_write_tool_ticket_rejected",
      "Support write tool Worker ticket rejected");
  }
  if (result.status === "not_found") return sendError(reply, 404,
    "support_write_tool_execution_not_found", "Support write execution not found");
  if (result.status === "invalid_arguments") return invalid(reply,
    "invalid_support_write_tool_arguments");
  if (result.status === "not_configured") return sendError(reply, 503,
    "support_write_tool_not_configured",
    `Support write tool not configured: ${result.reasonCode ?? "not_configured"}`);
  return sendError(reply, 409, result.status,
    `Support write tool ${phase} rejected`);
}

function worker(value: Record<string, unknown>) {
  return bounded(value.ticket, 4_096, 64) && code(value.workerCellId, 128) &&
    code(value.workerId, 128) && uuid(value.runId);
}
function workerValue(value: Record<string, unknown>) { return {
  ticket: value.ticket as string, workerCellId: value.workerCellId as string,
  workerId: value.workerId as string, runId: value.runId as string,
}; }
function argumentsValue(value: unknown) {
  const args = record(value);
  return args && Buffer.byteLength(JSON.stringify(args)) <= 8_192 ? args : null;
}
function internalAuthorized(request: FastifyRequest) {
  const expected = Buffer.from(process.env.INTERNAL_API_SECRET?.trim() ?? "");
  const authorization = request.headers.authorization;
  const supplied = Buffer.from(authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function record(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype
    ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function bounded(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && Buffer.byteLength(value.trim()) >= min &&
    Buffer.byteLength(value.trim()) <= max; }
function code(value: unknown, max: number): value is string { return typeof value ===
  "string" && Buffer.byteLength(value) <= max &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function locale(value: unknown): value is string { return typeof value === "string" &&
  /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function invalid(reply: FastifyReply, codeValue: string) { return sendError(reply, 400,
  codeValue, "Invalid Support write tool request"); }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401,
  "internal_error", "Unauthorized internal request"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
