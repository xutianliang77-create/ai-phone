import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EnterpriseMarketingAgentTurnResponse } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { enterpriseRequestTraceId } from "./enterprise-auth.js";
import { enterpriseMarketingAgentFallback, enterpriseMarketingAgentOptOut,
  type EnterpriseMarketingAgentProvider } from "./enterprise-marketing-agent.js";
import type { EnterpriseMarketingAgentRuntimeBinding,
  EnterpriseMarketingAgentTicketPayload } from
  "./enterprise-marketing-agent-ticket.js";
import type { EnterpriseRepositoryRuntime } from "./enterprise-repository-runtime.js";

export function registerEnterpriseMarketingAgentProviderRoutes(
  app: FastifyInstance, runtime: EnterpriseRepositoryRuntime,
  provider: EnterpriseMarketingAgentProvider,
  binding: EnterpriseMarketingAgentRuntimeBinding) {
  app.post("/provider/enterprise/marketing-agent/snapshot", async (request, reply) => {
    const ticket = verifiedTicket(request, binding, request.body);
    if (!ticket) return unauthorized(reply);
    if (!runtime.getMarketingAgentSnapshot) return postgresRequired(reply);
    const result = await runtime.getMarketingAgentSnapshot({ ticket,
      traceId: enterpriseRequestTraceId(request) });
    if (result.status !== "ready") return notReady(reply);
    return reply.send({ status: "ready", runId: result.run.id,
      communicationSessionId: result.run.communicationSessionId,
      dispatchGeneration: result.run.dispatchGeneration, locale: result.run.locale,
      voicePresetId: result.profile.voicePresetId,
      conversationState: result.run.conversationState,
      disclosure: { spokenText: result.run.disclosureText,
        authorized: Boolean(result.run.disclosureAuthorizedAt),
        delivered: Boolean(result.run.disclosureDeliveredAt) } });
  });

  app.post("/provider/enterprise/marketing-agent/disclosure/authorize",
    async (request, reply) => {
      const ticket = verifiedTicket(request, binding, request.body);
      if (!ticket) return unauthorized(reply);
      if (!runtime.authorizeMarketingAgentDisclosure) return postgresRequired(reply);
      const result = await runtime.authorizeMarketingAgentDisclosure({ ticket,
        traceId: enterpriseRequestTraceId(request), now: new Date().toISOString() });
      return result.status === "authorized" ? reply.send({ status: "authorized",
        runId: result.run.id, spokenText: result.run.disclosureText,
        dispatchGeneration: result.run.dispatchGeneration }) : conflict(reply);
    });

  app.post("/provider/enterprise/marketing-agent/disclosure/delivered",
    async (request, reply) => {
      const ticket = verifiedTicket(request, binding, request.body);
      if (!ticket) return unauthorized(reply);
      if (!runtime.deliverMarketingAgentDisclosure) return postgresRequired(reply);
      const result = await runtime.deliverMarketingAgentDisclosure({ ticket,
        traceId: enterpriseRequestTraceId(request), now: new Date().toISOString() });
      return result.status === "delivered" ? reply.send({ status: "delivered",
        runId: result.run.id, conversationState: result.run.conversationState })
        : conflict(reply);
    });

  app.post("/provider/enterprise/marketing-agent/turns", async (request, reply) => {
    const body = turnBody(request.body); const ticket = body
      ? binding.verify(body.ticket) : null;
    if (!body) return invalid(reply);
    if (!ticket) return unauthorized(reply);
    if (!runtime.prepareMarketingAgentTurn || !runtime.completeMarketingAgentTurn) {
      return postgresRequired(reply);
    }
    const traceId = enterpriseRequestTraceId(request); const now = new Date().toISOString();
    const prepared = await runtime.prepareMarketingAgentTurn({ ticket, traceId,
      inputTurnId: body.inputTurnId, idempotencyKey: body.idempotencyKey,
      customerText: body.customerText, detectedLocale: body.detectedLocale, now });
    if (prepared.status === "idempotency_conflict") return conflict(reply);
    if (prepared.status !== "ready") return notReady(reply);
    if (prepared.turn.output) {
      return reply.send(turnResponse(prepared.run, prepared.turn));
    }
    const generated = await generate(provider, prepared, body.customerText);
    const completed = await runtime.completeMarketingAgentTurn({ ticket, traceId,
      runId: prepared.run.id, turnId: prepared.turn.id, customerText: body.customerText,
      locale: prepared.content.profile.locale, evidenceHash: prepared.turn.evidenceHash,
      output: generated.output, status: generated.status,
      context: prepared.context, optOut: prepared.directive === "opt_out", now,
      ...(generated.providerFingerprint
        ? { providerFingerprint: generated.providerFingerprint } : {}),
      ...(generated.failureCode ? { failureCode: generated.failureCode } : {}) });
    return completed.status === "updated"
      ? reply.send(turnResponse(completed.run, completed.turn)) : conflict(reply);
  });

  app.post("/provider/enterprise/marketing-agent/tts/authorize",
    async (request, reply) => {
      const body = turnFenceBody(request.body); const ticket = body
        ? binding.verify(body.ticket) : null;
      if (!body) return invalid(reply); if (!ticket) return unauthorized(reply);
      if (!runtime.authorizeMarketingAgentTts) return postgresRequired(reply);
      const result = await runtime.authorizeMarketingAgentTts({ ticket,
        traceId: enterpriseRequestTraceId(request), turnId: body.turnId,
        now: new Date().toISOString() });
      return result.status === "authorized" && result.turn.output
        ? reply.send({ status: "authorized", runId: result.run.id,
          turnId: result.turn.id, dispatchGeneration: result.run.dispatchGeneration,
          spokenText: result.turn.output.spokenText,
          stopAfterPlayout: result.turn.output.action !== "continue" }) : conflict(reply);
    });

  app.post("/provider/enterprise/marketing-agent/turns/delivered",
    async (request, reply) => {
      const body = turnFenceBody(request.body); const ticket = body
        ? binding.verify(body.ticket) : null;
      if (!body) return invalid(reply); if (!ticket) return unauthorized(reply);
      if (!runtime.deliverMarketingAgentTurn) return postgresRequired(reply);
      const result = await runtime.deliverMarketingAgentTurn({ ticket,
        traceId: enterpriseRequestTraceId(request), turnId: body.turnId,
        now: new Date().toISOString() });
      return result.status === "delivered" ? reply.send({ status: "delivered",
        runId: result.run.id, turnId: result.turn.id,
        runStatus: result.run.status,
        ...(result.handoff ? { handoff: result.handoff } : {}) }) : conflict(reply);
    });

  app.post("/provider/enterprise/marketing-agent/finalize", async (request, reply) => {
    const body = finalizeBody(request.body); const ticket = body
      ? binding.verify(body.ticket) : null;
    if (!body) return invalid(reply); if (!ticket) return unauthorized(reply);
    if (!runtime.finalizeMarketingAgent) return postgresRequired(reply);
    const result = await runtime.finalizeMarketingAgent({ ticket,
      traceId: enterpriseRequestTraceId(request), outcome: body.outcome,
      now: new Date().toISOString() });
    return ["completed", "failed"].includes(result.status)
      ? reply.send({ status: result.status }) : conflict(reply);
  });
}

async function generate(provider: EnterpriseMarketingAgentProvider,
  prepared: Extract<Awaited<ReturnType<NonNullable<
    EnterpriseRepositoryRuntime["prepareMarketingAgentTurn"]>>>, { status: "ready" }>,
  customerText: string) {
  if (prepared.directive === "opt_out") return {
    output: enterpriseMarketingAgentOptOut(prepared.content.profile.locale),
    status: "ended" as const };
  if (prepared.directive === "handoff") return {
    output: enterpriseMarketingAgentFallback({ locale: prepared.content.profile.locale,
      kind: "handoff", reasonCode: "marketing_agent_handoff_queued" }),
    status: "handoff" as const };
  if (prepared.directive === "handoff_unavailable") return {
    output: enterpriseMarketingAgentFallback({ locale: prepared.content.profile.locale,
      kind: "handoff_unavailable",
      reasonCode: "marketing_agent_handoff_not_configured" }),
    status: "ended" as const,
    failureCode: "marketing_agent_handoff_not_configured" };
  const result = await provider.generate({ locale: prepared.content.profile.locale,
    customerText, recentTurns: prepared.context,
    conversationState: prepared.run.conversationState,
    profile: prepared.content.profile, terminology: prepared.content.terminology,
    evidence: prepared.evidence });
  if (result.status === "ready") return { output: result.output,
    status: result.output.action === "handoff" ? "handoff" as const :
      result.output.action === "end_call" ? "ended" as const : "generated" as const,
    providerFingerprint: result.providerFingerprint };
  return { output: enterpriseMarketingAgentFallback({
    locale: prepared.content.profile.locale, reasonCode: result.reasonCode }),
    status: "degraded" as const, failureCode: safeFailure(result.reasonCode) };
}

function turnResponse(run: { id: string; dispatchGeneration: number }, turn: {
  id: string; sequence: number; status: string;
  output?: EnterpriseMarketingAgentTurnResponse["output"];
  providerFingerprint?: string; failureCode?: string }): EnterpriseMarketingAgentTurnResponse {
  if (!turn.output) throw new Error("Marketing Agent turn output missing");
  const status = turn.failureCode ? "degraded" : turn.output.action === "handoff"
    ? "handoff" : turn.output.action === "end_call" ? "ended" : "generated";
  return { status, runId: run.id, turnId: turn.id, sequence: turn.sequence,
    dispatchGeneration: run.dispatchGeneration, output: turn.output,
    stopAfterPlayout: turn.output.action !== "continue",
    ...(turn.providerFingerprint ? { providerFingerprint: turn.providerFingerprint } : {}),
    ...(turn.failureCode ? { reasonCode: turn.failureCode } : {}) };
}
function verifiedTicket(request: FastifyRequest,
  binding: EnterpriseMarketingAgentRuntimeBinding, value: unknown) {
  const body = object(value); return body && exact(body, ["ticket"]) &&
    typeof body.ticket === "string" ? binding.verify(body.ticket) : null;
}
function turnBody(value: unknown) { const body = object(value); if (!body ||
  !exact(body, ["ticket", "inputTurnId", "idempotencyKey", "customerText",
    "detectedLocale"]) || !bounded(body.ticket, 4_096) || !key(body.inputTurnId) ||
  !key(body.idempotencyKey) || !bounded(body.customerText, 4_000) ||
  !locale(body.detectedLocale)) return null;
  return { ticket: body.ticket, inputTurnId: body.inputTurnId,
    idempotencyKey: body.idempotencyKey, customerText: body.customerText,
    detectedLocale: body.detectedLocale } as { ticket: string; inputTurnId: string;
      idempotencyKey: string; customerText: string; detectedLocale: string }; }
function turnFenceBody(value: unknown) { const body = object(value); return body &&
  exact(body, ["ticket", "turnId"]) && bounded(body.ticket, 4_096) && uuid(body.turnId)
  ? { ticket: body.ticket as string, turnId: body.turnId as string } : null; }
function finalizeBody(value: unknown) { const body = object(value); return body &&
  exact(body, ["ticket", "outcome"]) && bounded(body.ticket, 4_096) &&
  ["completed", "failed"].includes(String(body.outcome)) ? { ticket: body.ticket,
    outcome: body.outcome as "completed" | "failed" } : null; }
function object(value: unknown): Record<string, unknown> | null { return value &&
  typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value)
  .sort().join(",") === [...keys].sort().join(","); }
function bounded(value: unknown, max: number): value is string { return typeof value ===
  "string" && Boolean(value.trim()) && Buffer.byteLength(value) <= max; }
function key(value: unknown) { return typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value); }
function locale(value: unknown) { return typeof value === "string" &&
  /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value); }
function uuid(value: unknown) { return typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value); }
function safeFailure(value: string) { return /^[a-z][a-z0-9_]{1,79}$/.test(value)
  ? value : "marketing_agent_provider_failed"; }
function unauthorized(reply: FastifyReply) { return sendError(reply, 401,
  "marketing_agent_ticket_rejected", "Marketing Agent ticket rejected"); }
function invalid(reply: FastifyReply) { return sendError(reply, 400,
  "invalid_marketing_agent_provider_request", "Invalid Marketing Agent provider request"); }
function conflict(reply: FastifyReply) { return sendError(reply, 409,
  "marketing_agent_runtime_conflict", "Marketing Agent runtime conflict"); }
function notReady(reply: FastifyReply) { return sendError(reply, 503,
  "marketing_agent_not_ready", "Marketing Agent is not ready"); }
function postgresRequired(reply: FastifyReply) { return sendError(reply, 503,
  "enterprise_postgres_required", "Enterprise PostgreSQL runtime required"); }
