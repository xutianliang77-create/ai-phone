import { randomUUID } from "node:crypto";
import type { EnterpriseRepositoryRuntime } from
  "../../modules/enterprise/enterprise-repository-runtime.js";
import {
  compactEnterpriseSupportAgentContext,
  enterpriseSupportAgentRequestHash,
  validateEnterpriseSupportAgentOutput,
} from "../../modules/enterprise/enterprise-support-agent.js";
import { enterpriseSupportRagResponse } from
  "../../modules/enterprise/enterprise-support-rag.js";
import { createEnterpriseTenantContext } from
  "../../modules/enterprise/enterprise-tenant-context.js";
import {
  issueEnterpriseWorkerDispatchTicket,
  verifyEnterpriseWorkerDispatchTicket,
  type EnterpriseWorkerDispatchTicketPayload,
} from "../../modules/enterprise/enterprise-worker-dispatch-ticket.js";
import type { EnterpriseTenantPostgresPool } from
  "./enterprise-postgres-tenant-session.js";
import { withEnterprisePostgresUnitOfWork } from
  "./enterprise-postgres-unit-of-work.js";
import {
  auditSupportAgent,
  auditSupportAgentRag,
  supportAgentDate,
  supportAgentLeaseSeconds,
  supportAgentName,
  supportAgentNotReady,
  supportAgentRoomName,
  supportAgentRuntimeReadiness,
  supportAgentTicketPayload,
  supportAgentTicketTtlSeconds,
  supportAgentTurnHashes,
  supportAgentWorkerSigningSecret,
} from "./enterprise-postgres-support-agent-runtime-helpers.js";

type Runtime = Pick<EnterpriseRepositoryRuntime,
  "prepareSupportAgent" | "acceptSupportAgentWorker" |
  "heartbeatSupportAgentWorker" | "refreshSupportAgentWorker" |
  "prepareSupportAgentTurn" | "completeSupportAgentTurn" |
  "authorizeSupportAgentTts" | "deliverSupportAgentTurn" |
  "finalizeSupportAgentWorker">;
type Unit = Parameters<Parameters<typeof withEnterprisePostgresUnitOfWork>[2]>[0];
type WorkerInput = { ticket: string; workerCellId: string; workerId: string;
  traceId: string; now?: Date };

export function createEnterprisePostgresSupportAgentRuntime(
  pool: EnterpriseTenantPostgresPool,
): Runtime {
  return {
    async prepareSupportAgent(input) {
      const now = supportAgentDate(input.now);
      const signingSecret = supportAgentWorkerSigningSecret();
      if (!signingSecret) return supportAgentNotReady("worker_signing_not_configured");
      return withEnterprisePostgresUnitOfWork(pool, input.context, async (unit) => {
        let session = await unit.support.findSession(input.sessionId, true);
        if (!session) return supportAgentNotReady("support_session_not_found");
        if (session.status === "created") {
          const waiting = await unit.support.transition({ sessionId: session.id,
            status: "waiting", queueId: input.queueId,
            expectedVersion: session.version, occurredAt: now.toISOString() });
          if (waiting.status !== "updated") return supportAgentNotReady(waiting.status);
          session = waiting.session;
        }
        if (session.status === "waiting") {
          const active = await unit.support.transition({ sessionId: session.id,
            status: "ai_active", expectedVersion: session.version,
            occurredAt: now.toISOString() });
          if (active.status !== "updated") return supportAgentNotReady(active.status);
          session = active.session;
        }
        if (session.status !== "ai_active") return supportAgentNotReady("support_session_not_active");
        const binding = await unit.communicationBindings.findByBusiness("support", session.id);
        if (!binding || binding.kind !== "support") return supportAgentNotReady("support_binding_not_ready");
        const resolution = await unit.communicationPolicies.resolve({
          communicationSessionId: binding.communicationSessionId,
          authorizationEvidenceIds: [], readiness: supportAgentRuntimeReadiness(now), now,
        });
        if (!("snapshot" in resolution) || !resolution.snapshot) {
          return supportAgentNotReady(resolution.status);
        }
        if (!resolution.snapshot.allowedCapabilities.includes("voice_agent_runtime")) {
          return supportAgentNotReady(resolution.snapshot.reasonCode);
        }
        const roomName = supportAgentRoomName(binding.communicationSessionId);
        const agentName = supportAgentName();
        const issued = await unit.workerDispatches.issue({
          communicationSessionId: binding.communicationSessionId,
          capability: "voice_agent_runtime", callId: session.id, roomName,
          provider: "livekit_dispatch", agentName,
          idempotencyKey: `support-agent:${session.id}:g${binding.generation}`,
          leaseSeconds: supportAgentLeaseSeconds(),
          ticketTtlSeconds: supportAgentTicketTtlSeconds(), now,
        });
        if (issued.status !== "created" && issued.status !== "replayed") {
          return supportAgentNotReady(issued.status);
        }
        const run = await unit.supportAgents.createRun({ id: randomUUID(),
          supportSessionId: session.id,
          communicationSessionId: binding.communicationSessionId,
          dispatchGrantId: issued.grant.id, generation: binding.generation,
          locale: input.locale, countryCode: input.countryCode,
          productCode: input.productCode, createdAt: now.toISOString() });
        if (run.status === "conflict") return supportAgentNotReady("support_agent_run_conflict");
        const payload = supportAgentTicketPayload(issued.grant);
        await auditSupportAgent(unit, input.context, "support.agent.dispatch", session.id,
          { runId: run.run.id, generation: binding.generation }, now);
        return { status: "ready" as const, dispatch: {
          status: "ready", ticket: issueEnterpriseWorkerDispatchTicket({
            payload, signingSecret,
          }), runId: run.run.id, sessionId: session.id,
          communicationSessionId: binding.communicationSessionId,
          roomName, agentName, generation: binding.generation,
          expiresAt: issued.grant.expiresAt,
        } };
      });
    },

    acceptSupportAgentWorker(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const accepted = await unit.workerDispatches.accept({ payload,
          workerCellId: input.workerCellId, workerId: input.workerId,
          leaseSeconds: input.leaseSeconds, now: input.now });
        if (accepted.status !== "accepted") return accepted;
        const authorized = await authorizeAndResolve(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        return { status: "accepted" as const, snapshot: snapshot(authorized.run) };
      });
    },

    heartbeatSupportAgentWorker(input) {
      return withWorker(pool, input, (unit, payload) =>
        unit.workerDispatches.heartbeat({ payload,
          workerCellId: input.workerCellId, workerId: input.workerId,
          leaseSeconds: input.leaseSeconds, now: input.now }));
    },

    refreshSupportAgentWorker(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const refreshed = await unit.workerDispatches.refresh({ payload,
          workerCellId: input.workerCellId, workerId: input.workerId,
          leaseSeconds: input.leaseSeconds,
          ticketTtlSeconds: input.ticketTtlSeconds, now: input.now });
        const secret = supportAgentWorkerSigningSecret();
        if (refreshed.status !== "accepted" || !secret) return refreshed;
        const next = supportAgentTicketPayload(refreshed.grant);
        return { status: "accepted" as const,
          ticket: issueEnterpriseWorkerDispatchTicket({ payload: next,
            signingSecret: secret }), expiresAt: next.expiresAt };
      });
    },

    prepareSupportAgentTurn(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeAndResolve(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        const run = authorized.run;
        const context = compactEnterpriseSupportAgentContext(input.recentTurns);
        const now = input.now ?? new Date();
        const results = await unit.knowledge.search({ query: input.customerText,
          locale: run.locale, countryCode: run.countryCode,
          productCode: run.productCode, limit: 6, now: now.toISOString() });
        const resolution = enterpriseSupportRagResponse({ sessionId: run.supportSessionId,
          locale: run.locale, results });
        const hashes = supportAgentTurnHashes(input.customerText, context, resolution);
        const turn = await unit.supportAgents.beginTurn({ runId: run.id,
          supportSessionId: run.supportSessionId, inputTurnId: input.inputTurnId,
          idempotencyKey: input.idempotencyKey,
          requestHash: enterpriseSupportAgentRequestHash({
            inputTurnId: input.inputTurnId, customerText: input.customerText, context,
          }), ...hashes, createdAt: now.toISOString() });
        if (turn.status !== "created" && turn.status !== "replayed") return turn;
        if (turn.turn.evidenceHash !== hashes.evidenceHash) {
          return { status: "knowledge_changed" as const };
        }
        await auditSupportAgentRag(unit, createEnterpriseTenantContext({
          tenantId: payload.tenantId,
          actorUserId: "system:enterprise-support-agent",
          traceId: input.traceId,
        }), run.supportSessionId, resolution, now);
        return { status: "ready" as const, run, turn: turn.turn,
          resolution, context: [...context], replayed: turn.status === "replayed" };
      });
    },

    completeSupportAgentTurn(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeAndResolve(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        if (authorized.run.id !== input.runId) return { status: "run_mismatch" };
        const now = input.now ?? new Date();
        const results = await unit.knowledge.search({ query: input.customerText,
          locale: authorized.run.locale, countryCode: authorized.run.countryCode,
          productCode: authorized.run.productCode, limit: 6, now: now.toISOString() });
        const resolution = enterpriseSupportRagResponse({
          sessionId: authorized.run.supportSessionId,
          locale: authorized.run.locale, results,
        });
        const allowed = new Set(resolution.evidence.map((item) => item.citation));
        const output = validateEnterpriseSupportAgentOutput(input.output, allowed);
        const validStatus = input.status === "generated"
          ? output?.intent !== "handoff"
          : output?.intent === "handoff";
        const turn = await unit.supportAgents.findTurn(input.turnId, true);
        if (!output || !validStatus || !turn || turn.evidenceHash !==
          enterpriseSupportAgentRequestHash(resolution.evidence.map((item) => ({
            citation: item.citation, contentHash: item.contentHash,
          })))) return { status: "output_rejected" };
        const context = compactEnterpriseSupportAgentContext([
          ...input.context, { role: "customer", text: input.customerText },
          { role: "assistant", text: output.spokenText },
        ]);
        const completed = await unit.supportAgents.completeTurn({
          runId: input.runId, turnId: input.turnId, output, status: input.status,
          ...(input.providerFingerprint ?
            { providerFingerprint: input.providerFingerprint } : {}),
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
          contextDocument: [...context],
          contextHash: enterpriseSupportAgentRequestHash(context),
          completedAt: now.toISOString(),
        });
        if (completed.status !== "updated") return completed;
        if (output.intent === "handoff") {
          const session = await unit.support.findSession(
            authorized.run.supportSessionId, true,
          );
          if (!session || session.status !== "ai_active") {
            throw new Error("Support Agent handoff lost session fence");
          }
          const transitioned = await unit.support.transition({ sessionId: session.id,
            status: "handoff_requested", expectedVersion: session.version,
            occurredAt: now.toISOString() });
          if (transitioned.status !== "updated") {
            throw new Error("Support Agent handoff transition failed");
          }
        }
        return completed;
      });
    },

    authorizeSupportAgentTts(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeAndResolve(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        if (authorized.run.id !== input.runId) return { status: "run_mismatch" };
        const result = await unit.supportAgents.authorizeTts({ runId: input.runId,
          turnId: input.turnId,
          authorizedAt: (input.now ?? new Date()).toISOString() });
        return result.status === "authorized" && result.turn.output
          ? { status: "authorized" as const, generation: payload.generation,
              spokenText: result.turn.output.spokenText }
          : result;
      });
    },

    deliverSupportAgentTurn(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeAndResolve(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        if (authorized.run.id !== input.runId) return { status: "run_mismatch" };
        return unit.supportAgents.deliverTurn({ runId: input.runId,
          turnId: input.turnId,
          deliveredAt: (input.now ?? new Date()).toISOString() });
      });
    },

    finalizeSupportAgentWorker(input) {
      return withWorker(pool, input, async (unit, payload) => {
        const authorized = await authorizeAndResolve(unit, payload, input);
        if (authorized.status !== "ready") return authorized;
        const finalized = await unit.workerDispatches.finalize({ payload,
          workerCellId: input.workerCellId, workerId: input.workerId,
          outcome: input.outcome, now: input.now });
        if (!["completed", "failed"].includes(finalized.status)) return finalized;
        await unit.supportAgents.finalizeRun({ runId: authorized.run.id,
          status: input.outcome, finalizedAt: (input.now ?? new Date()).toISOString() });
        const session = await unit.support.findSession(
          authorized.run.supportSessionId, true,
        );
        const target = authorized.run.status === "ending" ? "ended" :
          authorized.run.status === "active"
            ? input.outcome === "failed" ? "failed" : "ended"
            : null;
        if (session && target && ["ai_active", "handoff_requested"]
          .includes(session.status)) {
          const transitioned = await unit.support.transition({ sessionId: session.id,
            status: target, expectedVersion: session.version,
            ...(target === "failed" ? { failureCode: "support_agent_failed" } : {}),
            occurredAt: (input.now ?? new Date()).toISOString() });
          if (transitioned.status !== "updated") {
            throw new Error("Support Agent final session transition failed");
          }
        }
        return finalized;
      });
    },
  };
}

function withWorker<T>(pool: EnterpriseTenantPostgresPool, input: WorkerInput,
  operation: (unit: Unit, payload: EnterpriseWorkerDispatchTicketPayload) => Promise<T>) {
  const secret = supportAgentWorkerSigningSecret();
  const payload = secret ? verifyEnterpriseWorkerDispatchTicket({
    ticket: input.ticket, signingSecret: secret, now: input.now,
  }) : null;
  if (!payload || payload.capability !== "voice_agent_runtime") {
    return Promise.resolve({ status: "invalid_ticket" as const });
  }
  return withEnterprisePostgresUnitOfWork(pool, createEnterpriseTenantContext({
    tenantId: payload.tenantId, actorUserId: "system:enterprise-support-agent",
    traceId: input.traceId,
  }), (unit) => operation(unit, payload));
}

async function authorizeAndResolve(unit: Unit,
  payload: EnterpriseWorkerDispatchTicketPayload, input: WorkerInput) {
  const effect = await unit.workerDispatches.authorize({ payload,
    workerCellId: input.workerCellId, workerId: input.workerId, now: input.now });
  if (effect.status !== "authorized") return effect;
  const binding = await unit.communicationBindings.findBySession(
    payload.communicationSessionId,
  );
  if (!binding || binding.kind !== "support" ||
    binding.generation !== payload.generation || binding.routeEpoch !== payload.routeEpoch) {
    return { status: "support_binding_mismatch" as const };
  }
  const run = await unit.supportAgents.findRunForGeneration(
    binding.businessId, payload.generation, true,
  );
  if (!run || run.dispatchGrantId !== payload.ticketId ||
    !["active", "handoff_requested", "ending"].includes(run.status)) {
    return { status: "support_run_not_active" as const };
  }
  return { status: "ready" as const, run };
}

function snapshot(run: Awaited<ReturnType<Unit["supportAgents"]["findRun"]>> & {}) {
  return { runId: run.id, sessionId: run.supportSessionId,
    communicationSessionId: run.communicationSessionId,
    roomName: supportAgentRoomName(run.communicationSessionId), generation: run.generation,
    locale: run.locale, countryCode: run.countryCode,
    productCode: run.productCode, conversationState: run.conversationState };
}
