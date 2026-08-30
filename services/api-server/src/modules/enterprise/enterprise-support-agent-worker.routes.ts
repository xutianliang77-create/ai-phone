import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseSupportAgentTurnResponse } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId } from "./enterprise-auth.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";
import {
  type EnterpriseSupportAgentProvider,
} from "./enterprise-support-agent.js";
import { orchestratePendingSupportWriteDecision, recoverSupportAgentToolAction,
  orchestrateSupportAgentOutput } from
  "./enterprise-support-agent-tool-orchestrator.js";

export function registerEnterpriseSupportAgentWorkerRoutes(
  app: FastifyInstance,
  runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseSupportAgentProvider,
) {
  app.post("/internal/enterprise/support-agent/snapshot", async (request, reply) => {
    if (!internalAuthorized(request)) return unauthorized(reply);
    const body = workerRequest(request.body);
    if (!body) return invalid(reply);
    if (!runtime.acceptSupportAgentWorker) return postgresRequired(reply);
    const result = await runtime.acceptSupportAgentWorker({ ...body,
      traceId: enterpriseRequestTraceId(request), leaseSeconds: leaseSeconds() });
    return workerResult(reply, result);
  });

  app.post("/internal/enterprise/support-agent/heartbeat", async (request, reply) => {
    if (!internalAuthorized(request)) return unauthorized(reply);
    const body = workerRequest(request.body);
    if (!body) return invalid(reply);
    if (!runtime.heartbeatSupportAgentWorker) return postgresRequired(reply);
    return workerResult(reply, await runtime.heartbeatSupportAgentWorker({ ...body,
      traceId: enterpriseRequestTraceId(request), leaseSeconds: leaseSeconds() }));
  });

  app.post("/internal/enterprise/support-agent/refresh", async (request, reply) => {
    if (!internalAuthorized(request)) return unauthorized(reply);
    const body = workerRequest(request.body);
    if (!body) return invalid(reply);
    if (!runtime.refreshSupportAgentWorker) return postgresRequired(reply);
    return workerResult(reply, await runtime.refreshSupportAgentWorker({ ...body,
      traceId: enterpriseRequestTraceId(request), leaseSeconds: leaseSeconds(),
      ticketTtlSeconds: ticketTtlSeconds() }));
  });

  app.post("/internal/enterprise/support-agent/turns", async (request, reply) => {
    if (!internalAuthorized(request)) return unauthorized(reply);
    const body = turnRequest(request.body);
    if (!body) return invalid(reply);
    if (!runtime.prepareSupportAgentTurn || !runtime.completeSupportAgentTurn) {
      return postgresRequired(reply);
    }
    const common = { ticket: body.ticket, workerCellId: body.workerCellId,
      workerId: body.workerId, traceId: enterpriseRequestTraceId(request) };
    const prepared = await runtime.prepareSupportAgentTurn({ ...common,
      inputTurnId: body.inputTurnId, idempotencyKey: body.idempotencyKey,
      customerText: body.customerText, recentTurns: body.recentTurns });
    if (!("run" in prepared)) return workerResult(reply, prepared);
    if (prepared.turn.output) {
      const toolAction = await recoverSupportAgentToolAction({ runtime, provider,
        prepared, customerText: body.customerText, worker: common });
      return reply.send(turnResponse(prepared.turn, prepared.run.generation,
        toolAction));
    }
    const pending = body.pendingConfirmation
      ? await orchestratePendingSupportWriteDecision({ runtime, prepared,
          pending: body.pendingConfirmation, customerText: body.customerText,
          worker: common }) : null;
    if (pending?.completed) {
      return reply.send(turnResponse(pending.turn, pending.run.generation));
    }
    const generated = pending?.generated ??
      await orchestrateSupportAgentOutput({ runtime, provider,
        prepared, customerText: body.customerText, worker: common });
    const completed = await runtime.completeSupportAgentTurn({ ...common,
      runId: prepared.run.id, turnId: prepared.turn.id,
      output: generated.output, status: generated.status,
      ...(generated.providerFingerprint
        ? { providerFingerprint: generated.providerFingerprint } : {}),
      ...(generated.failureCode ? { failureCode: generated.failureCode } : {}),
      ...(generated.toolResultEvidence
        ? { toolResultEvidence: generated.toolResultEvidence } : {}),
      ...(generated.toolConfirmationEvidence
        ? { toolConfirmationEvidence: generated.toolConfirmationEvidence } : {}),
      customerText: body.customerText, context: prepared.context });
    if (!("turn" in completed)) return workerResult(reply, completed);
    return reply.send(turnResponse(completed.turn, completed.run.generation,
      generated.toolAction));
  });

  app.post("/internal/enterprise/support-agent/tts/authorize",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const body = turnFenceRequest(request.body);
      if (!body) return invalid(reply);
      if (!runtime.authorizeSupportAgentTts) return postgresRequired(reply);
      return workerResult(reply, await runtime.authorizeSupportAgentTts({ ...body,
        traceId: enterpriseRequestTraceId(request) }));
    });

  app.post("/internal/enterprise/support-agent/turns/delivered",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const body = turnFenceRequest(request.body);
      if (!body) return invalid(reply);
      if (!runtime.deliverSupportAgentTurn) return postgresRequired(reply);
      return workerResult(reply, await runtime.deliverSupportAgentTurn({ ...body,
        traceId: enterpriseRequestTraceId(request) }));
    });

  app.post("/internal/enterprise/support-agent/finalize", async (request, reply) => {
    if (!internalAuthorized(request)) return unauthorized(reply);
    const body = finalizeRequest(request.body);
    if (!body) return invalid(reply);
    if (!runtime.finalizeSupportAgentWorker) return postgresRequired(reply);
    return workerResult(reply, await runtime.finalizeSupportAgentWorker({ ...body,
      traceId: enterpriseRequestTraceId(request) }));
  });
}

function turnResponse(
  turn: { id: string; sequence: number; status: string;
    output?: EnterpriseSupportAgentTurnResponse["output"];
    providerFingerprint?: string; failureCode?: string },
  generation: number,
  toolAction?: EnterpriseSupportAgentTurnResponse["toolAction"],
): EnterpriseSupportAgentTurnResponse {
  if (!turn.output) throw new Error("Support Agent turn output is missing");
  const status = turn.failureCode ? "degraded" :
    turn.output.intent === "handoff" ? "handoff" : "generated";
  return { status, turnId: turn.id, sequence: turn.sequence, generation,
    output: turn.output,
    ...(turn.providerFingerprint ? { providerFingerprint: turn.providerFingerprint } : {}),
    ...(turn.failureCode ? { reasonCode: turn.failureCode } : {}),
    ...(toolAction ? { toolAction } : {}) };
}

function workerRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["ticket", "workerCellId", "workerId"]) ||
    !bounded(body.ticket, 4_096, 64) || !code(body.workerCellId, 128) ||
    !code(body.workerId, 128)) return null;
  return { ticket: body.ticket, workerCellId: body.workerCellId,
    workerId: body.workerId };
}
function turnRequest(value: unknown) {
  const body = record(value);
  const required = ["ticket", "workerCellId", "workerId", "inputTurnId",
    "idempotencyKey", "customerText", "recentTurns"];
  if (!body || !exact(body, body.pendingConfirmation === undefined
    ? required : [...required, "pendingConfirmation"])) return null;
  const worker = workerRequest({ ticket: body.ticket,
    workerCellId: body.workerCellId, workerId: body.workerId });
  if (!worker || !code(body.inputTurnId, 160) || !code(body.idempotencyKey, 160) ||
    !bounded(body.customerText, 4_000) || !Array.isArray(body.recentTurns) ||
    body.recentTurns.length > 12) return null;
  const recentTurns = body.recentTurns.map(recentTurn);
  const pending = body.pendingConfirmation === undefined ? undefined
    : pendingConfirmation(body.pendingConfirmation);
  return recentTurns.some((turn) => !turn) || body.pendingConfirmation !== undefined &&
    !pending ? null : { ...worker,
    inputTurnId: body.inputTurnId, idempotencyKey: body.idempotencyKey,
    customerText: body.customerText,
    recentTurns: recentTurns as Array<{ role: "customer" | "assistant"; text: string }>,
    ...(pending ? { pendingConfirmation: pending } : {}) };
}
function pendingConfirmation(value: unknown) {
  const item = record(value);
  if (!item || !exact(item, ["executionId", "confirmationId", "toolName",
    "arguments", "expiresAt"]) || !uuid(item.executionId) ||
    !uuid(item.confirmationId) || !["ticket.create", "callback.schedule", "note.add"]
      .includes(String(item.toolName)) || !timestamp(item.expiresAt)) return null;
  const args = record(item.arguments);
  return args && Buffer.byteLength(JSON.stringify(args)) <= 8_192
    ? { executionId: item.executionId, confirmationId: item.confirmationId,
        toolName: item.toolName as "ticket.create" | "callback.schedule" | "note.add",
        arguments: args, expiresAt: item.expiresAt as string } : null;
}
function recentTurn(value: unknown) {
  const turn = record(value);
  return turn && exact(turn, ["role", "text"]) &&
    ["customer", "assistant"].includes(String(turn.role)) && bounded(turn.text, 1_500)
    ? { role: turn.role as "customer" | "assistant", text: turn.text } : null;
}
function turnFenceRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body,
    ["ticket", "workerCellId", "workerId", "runId", "turnId"])) return null;
  const worker = workerRequest({ ticket: body.ticket,
    workerCellId: body.workerCellId, workerId: body.workerId });
  return worker && uuid(body.runId) && uuid(body.turnId)
    ? { ...worker, runId: body.runId, turnId: body.turnId } : null;
}
function finalizeRequest(value: unknown) {
  const body = record(value);
  if (!body || !exact(body, ["ticket", "workerCellId", "workerId", "outcome"])) {
    return null;
  }
  const worker = workerRequest({ ticket: body.ticket,
    workerCellId: body.workerCellId, workerId: body.workerId });
  return worker && ["completed", "failed"].includes(String(body.outcome))
    ? { ...worker, outcome: body.outcome as "completed" | "failed" } : null;
}
function workerResult(reply: FastifyReply, result: { status: string }) {
  if (["accepted", "authorized", "delivered", "completed", "failed"]
    .includes(result.status)) return reply.send(result);
  if (["invalid_ticket", "ticket_expired"].includes(result.status)) {
    return sendError(reply, 403, "support_agent_ticket_rejected",
      "Support Agent Worker ticket rejected");
  }
  return sendError(reply, 409, "support_agent_runtime_conflict",
    "Support Agent runtime conflict");
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
  typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).sort().join(",") === [...keys].sort().join(","); }
function bounded(value: unknown, max: number, min = 1): value is string { return typeof value === "string" && Buffer.byteLength(value.trim()) >= min && Buffer.byteLength(value.trim()) <= max; }
function code(value: unknown, max: number): value is string { return typeof value === "string" && Buffer.byteLength(value) <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function timestamp(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function leaseSeconds() { return envInt("ENTERPRISE_SUPPORT_AGENT_WORKER_LEASE_SECONDS", 45, 15, 300); }
function ticketTtlSeconds() { return envInt("ENTERPRISE_SUPPORT_AGENT_TICKET_TTL_SECONDS", 300, 30, 300); }
function envInt(name: string, fallback: number, min: number, max: number) { const value = Number(process.env[name] ?? fallback); return Number.isInteger(value) && value >= min && value <= max ? value : fallback; }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401, "internal_error", "Unauthorized internal request"); }
function invalid(reply: FastifyReply) { return sendError(reply, 400, "invalid_support_agent_worker_request", "Invalid Support Agent Worker request"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503, "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
