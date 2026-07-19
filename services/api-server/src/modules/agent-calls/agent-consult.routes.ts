import { createHmac } from "node:crypto";
import type { AgentConsultDto } from "@translation/contracts";
import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { createCallRoomToken } from "../call-links/call-room-token.js";
import { readCallRoomHumanPresence } from "../call-links/call-room-worker.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { LiveKitSipProviderAdapter } from
  "../call-links/livekit-sip-provider-adapter.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { evaluateAgentCallTargetPolicy } from "./agent-call-gray-policy.js";
import { findAgentCallDraft } from "./agent-calls-runtime.repository.js";
import {
  beginAgentConsult,
  findAgentConsult,
  listAgentConsults,
  updateAgentConsult,
} from "./agent-consult-runtime.repository.js";
import { getAgentConsultConfig } from "./agent-consult-readiness.js";
import { LiveKitAgentConsultRoom } from "./livekit-agent-consult-room.js";
import {
  findActiveAgentRun,
  findAgentRun,
} from "./agent-orchestration-runtime.repository.js";

type SipFactory = (config: ConstructorParameters<typeof LiveKitSipProviderAdapter>[0]) =>
  Pick<LiveKitSipProviderAdapter, "createParticipant">;
type RoomFactory = (config: ConstructorParameters<typeof LiveKitAgentConsultRoom>[0]) =>
  Pick<LiveKitAgentConsultRoom, "ensure">;
let testSipFactory: SipFactory | null = null;
let testRoomFactory: RoomFactory | null = null;

export function setAgentConsultStartFactoriesForTests(input: {
  sip?: SipFactory | null;
  room?: RoomFactory | null;
}) {
  if (input.sip !== undefined) testSipFactory = input.sip;
  if (input.room !== undefined) testRoomFactory = input.room;
}

export function registerAgentConsultRoutes(app: FastifyInstance) {
  app.post("/ai-calling-agent/drafts/:draftId/consults", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const body = parseStart(request.body);
    if (!body) return invalid(reply);
    const config = getAgentConsultConfig();
    if (!config.ok) return unavailable(reply);
    const draftId = (request.params as { draftId: string }).draftId;
    const binding = await validateStart(account.id, draftId, config.config.maxAttempts);
    if (!binding.ok) return sendError(reply, binding.code, binding.error, binding.message);
    const targetPolicy = evaluateAgentCallTargetPolicy(body.targetPhone);
    if (!targetPolicy.allowed) {
      return sendError(
        reply,
        targetPolicy.statusCode,
        `agent_consult_${targetPolicy.code}`,
        targetPolicy.message,
      );
    }
    const requestHash = secretHash("consult-request", {
      runId: binding.run.id,
      targetPhone: body.targetPhone,
      idempotencyKey: body.idempotencyKey,
    });
    const begun = await withSessionWriteLock(binding.call.callId, () =>
      beginAgentConsult({
        runId: binding.run.id,
        sessionId: binding.call.sessionId,
        mainRoomName: binding.call.roomName,
        operatorPhoneHash: secretHash("consult-phone", body.targetPhone),
        idempotencyKey: body.idempotencyKey,
        requestHash,
        ttlSeconds: config.config.ttlSeconds,
      }));
    if (!("consult" in begun)) {
      return sendError(reply, 409, "agent_consult_run_missing", "Agent run unavailable");
    }
    if (begun.status === "payload_conflict" || begun.status === "active_conflict") {
      return sendError(reply, 409, "agent_consult_conflict", "Another consult is active");
    }
    if (begun.status === "replayed" && begun.consult.providerOperationId) {
      return reply.status(202).send({ consult: consultResponse(begun.consult), replayed: true });
    }
    const consult = begun.consult;
    const operation = (await beginProviderOperation({
      sessionId: consult.sessionId,
      provider: "livekit_sip",
      operationType: "sip_consult",
      operationKey: consult.id,
      idempotencyKey: `sip-consult:${consult.sessionId}:${consult.id}`,
      requestHash,
    })).operation;
    if (["accepted", "active", "unknown"].includes(operation.status)) {
      await updateAgentConsult({
        consultId: consult.id,
        status: "dialing",
        providerOperationId: operation.id,
      });
      return reply.status(202).send({
        consult: consultResponse((await findAgentConsult(consult.id))!),
        replayed: true,
      });
    }
    if (["failed", "cancelled"].includes(operation.status)) {
      await updateAgentConsult({
        consultId: consult.id, status: "failed", failureCode: "dial_failed",
      });
      return sendError(reply, 503, "agent_consult_dial_failed", "Consult call failed");
    }
    const room = (testRoomFactory ?? ((value) =>
      new LiveKitAgentConsultRoom(value)))(config.config.room);
    const ensured = await room.ensure(consult.consultRoomName);
    if (!ensured.ok) {
      await updateProviderOperation({
        operationId: operation.id,
        status: "failed",
        errorClass: ensured.errorClass,
      });
      await updateAgentConsult({
        consultId: consult.id, status: "failed", failureCode: "room_failed",
      });
      return unavailable(reply);
    }
    await updateAgentConsult({
      consultId: consult.id,
      status: "dialing",
      expectedVersion: consult.version,
      providerOperationId: operation.id,
    });
    const sip = (testSipFactory ?? ((value) =>
      new LiveKitSipProviderAdapter(value)))(config.config.sip);
    const result = await sip.createParticipant({
      operationId: operation.id,
      sessionId: consult.sessionId,
      expectedVersion: operation.version,
      idempotencyKey: operation.idempotencyKey,
      deadlineAt: deadline(config.config.sip.requestTimeoutSeconds),
      payload: {
        roomName: consult.consultRoomName,
        phoneNumberReference: body.targetPhone,
        participantIdentity: consult.operatorParticipantIdentity,
        participantRole: "operator",
        consultId: consult.id,
      },
    });
    await updateProviderOperation({
      operationId: operation.id,
      status: result.ok ? "accepted"
        : result.reconciliationRequired ? "unknown" : "failed",
      ...(result.ok ? {
        externalOperationId: result.externalOperationId,
        externalResourceId: result.externalResourceId,
      } : { errorClass: result.errorClass }),
    });
    if (!result.ok && !result.reconciliationRequired) {
      await updateAgentConsult({
        consultId: consult.id, status: "failed", failureCode: result.errorClass,
      });
      return sendError(reply, 503, "agent_consult_dial_failed", "Consult call failed");
    }
    return reply.status(202).send({
      consult: consultResponse((await findAgentConsult(consult.id))!),
      replayed: begun.status === "replayed",
    });
  });

  app.post(
    "/ai-calling-agent/drafts/:draftId/consults/:consultId/join",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const binding = await agentConsultBinding(account.id, request.params);
      if (!binding.ok) return sendError(reply, binding.code, binding.error, binding.message);
      if (!["dialing", "connected"].includes(binding.consult.status)) {
        return sendError(reply, 409, "agent_consult_not_joinable", "Consult is not joinable");
      }
      const presence = await readCallRoomHumanPresence(binding.call);
      if (!presence.ok) return unavailable(reply);
      if (presence.presence.activeHostCount > 0) {
        return sendError(
          reply,
          409,
          "agent_consult_main_host_connected",
          "Leave the main room before private consultation",
        );
      }
      const token = await createCallRoomToken({
        callId: binding.call.callId,
        roomName: binding.consult.consultRoomName,
        participantRole: "host",
        participantName: "operator-consult-host",
      });
      return token.ok ? { token } : unavailable(reply);
    },
  );

  app.get(
    "/ai-calling-agent/drafts/:draftId/consults/:consultId",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const binding = await agentConsultBinding(account.id, request.params);
      return binding.ok
        ? { consult: consultResponse(binding.consult) }
        : sendError(reply, binding.code, binding.error, binding.message);
    },
  );
}

async function validateStart(userId: string, draftId: string, maxAttempts: number) {
  const draft = await findAgentCallDraft(userId, draftId);
  const call = draft?.callId ? await findCallLink(draft.callId) : null;
  const run = draft ? await findActiveAgentRun(draft.id, "autonomous") : null;
  if (!draft || !call || !run) return denied(404, "agent_consult_not_found", "Call not found");
  if (call.purpose !== "voice_agent" || draft.status !== "takeover_requested" ||
    !draft.takeoverReadyAt || !draft.takeoverResolvedAt) {
    return denied(409, "agent_consult_takeover_required", "Human takeover is required");
  }
  if ((await listAgentConsults(run.id)).length >= maxAttempts) {
    return denied(429, "agent_consult_attempt_limit", "Consult attempt limit reached");
  }
  const presence = await readCallRoomHumanPresence(call);
  if (!presence.ok) return denied(503, "agent_consult_presence_unavailable", "Presence unavailable");
  if (presence.presence.activeHostCount !== 1) {
    return denied(409, "agent_consult_host_required", "One takeover host must be connected");
  }
  return { ok: true as const, draft, call, run };
}

export async function agentConsultBinding(userId: string, params: unknown) {
  const value = params as { draftId?: string; consultId?: string };
  const draft = value.draftId ? await findAgentCallDraft(userId, value.draftId) : null;
  const call = draft?.callId ? await findCallLink(draft.callId) : null;
  const consult = value.consultId ? await findAgentConsult(value.consultId) : null;
  const run = consult ? await findAgentRun(consult.runId) : null;
  if (!draft || !call || !consult || !run || run.taskId !== draft.id ||
    run.mode !== "autonomous" || consult.sessionId !== call.sessionId) {
    return denied(404, "agent_consult_not_found", "Consult not found");
  }
  return { ok: true as const, draft, call, run, consult };
}

function parseStart(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  return typeof value.targetPhone === "string" && /^\+[1-9]\d{7,14}$/.test(value.targetPhone) &&
      validKey(value.idempotencyKey)
    ? { targetPhone: value.targetPhone, idempotencyKey: value.idempotencyKey }
    : null;
}

export function consultResponse(consult: AgentConsultDto) {
  const {
    operatorPhoneHash: _phoneHash,
    requestHash: _requestHash,
    idempotencyKey: _idempotencyKey,
    ...response
  } = consult;
  return response;
}

function secretHash(purpose: string, value: unknown) {
  return createHmac("sha256", process.env.INTERNAL_API_SECRET ?? "")
    .update(`${purpose}:${JSON.stringify(value)}`).digest("hex");
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= 128;
}

function deadline(seconds: number) {
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function denied(code: 404 | 409 | 429 | 503, error: string, message: string) {
  return { ok: false as const, code, error, message };
}

function invalid(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 400, "invalid_agent_consult_request", "Invalid consult request");
}

function unavailable(reply: Parameters<typeof sendError>[0]) {
  return sendError(reply, 503, "agent_consult_unavailable", "Operator consultation unavailable");
}
