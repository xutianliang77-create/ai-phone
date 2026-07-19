import type { FastifyInstance } from "fastify";
import type {
  AuthorizeAiCallingAgentRequest,
  CancelAiCallingAgentDraftRequest,
  CreateAiCallingAgentDraftRequest,
  RequestAiCallingAgentTakeoverRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { registerAgentCallInternalRoutes } from "./agent-call-internal.routes.js";
import { registerAgentCallPstnWebhookRoutes } from "./agent-call-pstn-webhook.routes.js";
import {
  toAgentCallDto as toDto,
} from "./agent-call-route-helpers.js";
import {
  authorizeAgentCallDraft,
  cancelAgentCallDraft,
  createAgentCallDraft,
  findAgentCallDraft,
  listAgentCallDrafts,
  requestAgentCallTakeover,
} from "./agent-calls-runtime.repository.js";
import { registerAgentAssistRoutes } from "./agent-assist.routes.js";
import { registerAgentCallStartRoute } from "./agent-call-start.routes.js";
import { registerVoiceAgentCallExecutionRoutes } from
  "./voice-agent-call-execution.routes.js";
import { registerVoiceAgentRuntimeRoutes } from "./voice-agent-runtime.routes.js";
import { getVoiceAgentRuntimeSupervisor } from "./voice-agent-runtime-supervisor.js";
import { registerVoiceAgentToolGatewayRoutes } from
  "./voice-agent-tool-gateway.routes.js";
import { registerAgentCallTakeoverRoutes } from "./agent-call-takeover.routes.js";
import { findSessionProviderOperation } from
  "../provider-operations/provider-operations-runtime.repository.js";
import { publishVoiceAgentControl } from "./voice-agent-control-publisher.js";
import { registerAgentConsultRoutes } from "./agent-consult.routes.js";
import { registerAgentConsultControlRoutes } from "./agent-consult-control.routes.js";
import { validateVoiceAgentRecordingAuthorization } from
  "./voice-agent-recording-consent.js";

export async function registerAgentCallRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => {
    await getVoiceAgentRuntimeSupervisor().shutdown();
  });
  await registerAgentCallPstnWebhookRoutes(app);
  await registerAgentCallInternalRoutes(app);
  registerVoiceAgentCallExecutionRoutes(app);
  registerVoiceAgentRuntimeRoutes(app);
  registerVoiceAgentToolGatewayRoutes(app);
  registerAgentCallTakeoverRoutes(app);
  registerAgentAssistRoutes(app);
  registerAgentConsultRoutes(app);
  registerAgentConsultControlRoutes(app);
  registerAgentCallStartRoute(app);

  app.get("/ai-calling-agent/drafts", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return { drafts: (await listAgentCallDrafts(account.id)).map(toDto) };
  });

  app.post("/ai-calling-agent/drafts", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const draft = await createAgentCallDraft(
      account.id,
      request.body as CreateAiCallingAgentDraftRequest,
    );
    if (!draft) {
      return sendError(
        reply,
        400,
        "invalid_agent_call_draft",
        "Invalid agent call draft",
      );
    }
    return reply.status(201).send({ draft: toDto(draft) });
  });

  app.get("/ai-calling-agent/drafts/:draftId", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const draft = await findAgentCallDraft(
      account.id,
      (request.params as { draftId: string }).draftId,
    );
    if (!draft)
      return sendError(
        reply,
        404,
        "agent_call_draft_not_found",
        "Draft not found",
      );
    return { draft: toDto(draft) };
  });

  app.post(
    "/ai-calling-agent/drafts/:draftId/authorize",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const authorization = request.body as AuthorizeAiCallingAgentRequest;
      const recording = validateVoiceAgentRecordingAuthorization(authorization);
      if (!recording.ok) {
        if (recording.code === "recording_not_ready") {
          return reply.status(503).send({
            error: {
              code: "voice_agent_recording_not_ready",
              message: "Voice Agent recording consent is unavailable",
            },
            readiness: recording.configured,
          });
        }
        return sendError(
          reply,
          400,
          "voice_agent_recording_policy_invalid",
          "Recording request and policy do not match",
        );
      }
      const result = await authorizeAgentCallDraft(
        account.id,
        (request.params as { draftId: string }).draftId,
        authorization,
      );
      if (result.status === "not_found") {
        return sendError(
          reply,
          404,
          "agent_call_draft_not_found",
          "Draft not found",
        );
      }
      if (result.status === "invalid") {
        return sendError(
          reply,
          400,
          "agent_call_authorization_required",
          "User confirmation required",
        );
      }
      if (result.status === "cancelled") {
        return reply.status(409).send({
          error: {
            code: "agent_call_cancelled",
            message: "Draft was cancelled",
          },
          draft: toDto(result.draft),
        });
      }
      if (result.status === "invalid_state") {
        return reply.status(409).send({
          error: {
            code: "agent_call_invalid_state",
            message: "Draft cannot be authorized",
          },
          draft: toDto(result.draft),
        });
      }
      if (result.status === "requires_human_takeover") {
        return reply.status(409).send({
          error: {
            code: "agent_call_requires_human_takeover",
            message: "High risk agent calls require human takeover",
          },
          draft: toDto(result.draft),
        });
      }
      return { draft: toDto(result.draft) };
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/takeover",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const draftId = (request.params as { draftId: string }).draftId;
      const current = await findAgentCallDraft(account.id, draftId);
      if (!current) {
        return sendError(reply, 404, "agent_call_draft_not_found", "Draft not found");
      }
      const dial = current.callId
        ? await findSessionProviderOperation(current.callId, "sip_outbound")
        : null;
      if (current.status !== "requires_human_takeover" &&
        current.status !== "takeover_requested" &&
        (current.status !== "in_progress" || dial?.status !== "active")) {
        return sendError(
          reply,
          409,
          "agent_call_takeover_not_ready",
          "Call is not ready for human takeover",
        );
      }
      const draft = await requestAgentCallTakeover(
        account.id,
        draftId,
        request.body as RequestAiCallingAgentTakeoverRequest,
      );
      if (!draft) {
        return sendError(reply, 404, "agent_call_draft_not_found", "Draft not found");
      }
      if (draft.callId) {
        const control = await publishVoiceAgentControl({
          callId: draft.callId,
          command: "takeover",
        });
        if (!control.ok) {
          request.log.warn(
            { callId: draft.callId, code: control.code },
            "Voice Agent takeover will use heartbeat fallback",
          );
        }
      }
      return { draft: toDto(draft) };
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/cancel",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const result = await cancelAgentCallDraft(
        account.id,
        (request.params as { draftId: string }).draftId,
        request.body as CancelAiCallingAgentDraftRequest,
      );
      if (result.status === "mutation_conflict") {
        return sendError(
          reply,
          409,
          "agent_call_mutation_conflict",
          "Another draft operation is already in progress",
        );
      }
      if (result.status === "not_found") {
        return sendError(
          reply,
          404,
          "agent_call_draft_not_found",
          "Draft not found",
        );
      }
      if (result.status === "invalid_state") {
        return reply.status(409).send({
          error: {
            code: "agent_call_cannot_cancel",
            message: "Draft cannot be cancelled",
          },
          draft: toDto(result.draft),
        });
      }
      if (result.draft.callId) {
        const control = await publishVoiceAgentControl({
          callId: result.draft.callId,
          command: "cancel",
        });
        if (!control.ok) {
          request.log.warn(
            { callId: result.draft.callId, code: control.code },
            "Voice Agent cancellation will use heartbeat fallback",
          );
        }
      }
      return { draft: toDto(result.draft) };
    },
  );

}
