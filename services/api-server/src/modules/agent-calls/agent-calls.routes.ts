import type { FastifyInstance } from "fastify";
import type {
  AuthorizeAiCallingAgentRequest,
  CancelAiCallingAgentDraftRequest,
  CreateAiCallingAgentDraftRequest,
  RequestAiCallingAgentTakeoverRequest,
  StartAiCallingAgentCallRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { registerAgentCallInternalRoutes } from "./agent-call-internal.routes.js";
import { getAgentCallExecutionReadiness } from "./agent-call-execution-readiness.js";
import { evaluateAgentCallStartPolicy } from "./agent-call-gray-policy.js";
import { registerAgentCallPstnWebhookRoutes } from "./agent-call-pstn-webhook.routes.js";
import {
  isStarted,
  toAgentCallDto as toDto,
} from "./agent-call-route-helpers.js";
import { getAgentCallUsageReadiness } from "./agent-call-usage-readiness.js";
import {
  authorizeAgentCallDraft,
  cancelAgentCallDraft,
  createAgentCallDraft,
  findAgentCallDraft,
  listAgentCallDrafts,
  requestAgentCallTakeover,
  startAgentCallDraft,
} from "./agent-calls.repository.js";

export async function registerAgentCallRoutes(app: FastifyInstance) {
  await registerAgentCallPstnWebhookRoutes(app);
  await registerAgentCallInternalRoutes(app);

  app.get("/ai-calling-agent/drafts", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    return { drafts: listAgentCallDrafts(account.id).map(toDto) };
  });

  app.post("/ai-calling-agent/drafts", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const draft = createAgentCallDraft(
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
    const account = requireAccount(request, reply);
    if (!account) return;
    const draft = findAgentCallDraft(
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
      const account = requireAccount(request, reply);
      if (!account) return;
      const result = authorizeAgentCallDraft(
        account.id,
        (request.params as { draftId: string }).draftId,
        request.body as AuthorizeAiCallingAgentRequest,
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
      const account = requireAccount(request, reply);
      if (!account) return;
      const draft = requestAgentCallTakeover(
        account.id,
        (request.params as { draftId: string }).draftId,
        request.body as RequestAiCallingAgentTakeoverRequest,
      );
      if (!draft)
        return sendError(
          reply,
          404,
          "agent_call_draft_not_found",
          "Draft not found",
        );
      return { draft: toDto(draft) };
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/cancel",
    async (request, reply) => {
      const account = requireAccount(request, reply);
      if (!account) return;
      const result = cancelAgentCallDraft(
        account.id,
        (request.params as { draftId: string }).draftId,
        request.body as CancelAiCallingAgentDraftRequest,
      );
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
      return { draft: toDto(result.draft) };
    },
  );

  app.post(
    "/ai-calling-agent/drafts/:draftId/start",
    async (request, reply) => {
      const account = requireAccount(request, reply);
      if (!account) return;
      const draftId = (request.params as { draftId: string }).draftId;
      const draft = findAgentCallDraft(account.id, draftId);
      if (!draft)
        return sendError(
          reply,
          404,
          "agent_call_draft_not_found",
          "Draft not found",
        );
      if (isStarted(draft.status)) return { draft: toDto(draft) };
      if (draft.status !== "authorized") {
        return reply.status(409).send({
          error: {
            code: "agent_call_not_authorized",
            message: "Draft is not authorized",
          },
          draft: toDto(draft),
        });
      }
      if (!draft.targetPhone) {
        return reply.status(400).send({
          error: {
            code: "agent_call_target_required",
            message: "Target phone is required",
          },
          draft: toDto(draft),
        });
      }

      const startPolicy = evaluateAgentCallStartPolicy({
        userId: account.id,
        targetPhone: draft.targetPhone,
        drafts: listAgentCallDrafts(account.id),
      });
      if (!startPolicy.allowed) {
        return reply.status(startPolicy.statusCode).send({
          error: { code: `agent_call_${startPolicy.code}`, message: startPolicy.message },
          draft: toDto(draft),
        });
      }
      if (process.env.AGENT_CALL_GRAY_ENABLED === "true" &&
        (!draft.recipientDisclosureConfirmed || !draft.disclosurePromptVersion)) {
        return reply.status(409).send({
          error: {
            code: "agent_call_disclosure_required",
            message: "Recipient AI disclosure confirmation is required",
          },
          draft: toDto(draft),
        });
      }

      const readiness = getAgentCallExecutionReadiness();
      if (readiness.status !== "ready") {
        return reply.status(503).send({
          error: {
            code: "agent_call_execution_not_ready",
            message: "Agent call execution is not configured",
          },
          readiness,
          draft: toDto(draft),
        });
      }
      const usageReadiness = getAgentCallUsageReadiness(account.id);
      if (usageReadiness.status !== "ready") {
        return reply.status(402).send({
          error: {
            code: "agent_call_insufficient_balance",
            message: "Agent call requires remaining usage balance",
          },
          usage: usageReadiness,
          draft: toDto(draft),
        });
      }
      const result = startAgentCallDraft(
        account.id,
        draftId,
        request.body as StartAiCallingAgentCallRequest,
      );
      if (result.status === "policy_denied") {
        return reply.status(result.policy.statusCode).send({
          error: {
            code: `agent_call_${result.policy.code}`,
            message: result.policy.message,
          },
          draft: toDto(result.draft),
        });
      }
      if (result.status === "disclosure_required") {
        return reply.status(409).send({
          error: {
            code: "agent_call_disclosure_required",
            message: "Recipient AI disclosure confirmation is required",
          },
          draft: toDto(result.draft),
        });
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
            code: "agent_call_not_authorized",
            message: "Draft is not authorized",
          },
          draft: toDto(result.draft),
        });
      }
      if (result.status === "missing_target") {
        return reply.status(400).send({
          error: {
            code: "agent_call_target_required",
            message: "Target phone is required",
          },
          draft: toDto(result.draft),
        });
      }
      if (result.status === "invalid_consent") {
        return sendError(
          reply,
          400,
          "agent_call_consent_mismatch",
          "Consent prompt mismatch",
        );
      }
      if (result.status === "insufficient_balance") {
        return reply.status(402).send({
          error: {
            code: "agent_call_insufficient_balance",
            message: "Agent call requires remaining usage balance",
          },
          usage: result.usage,
          draft: toDto(result.draft),
        });
      }
      return { draft: toDto(result.draft) };
    },
  );

}
