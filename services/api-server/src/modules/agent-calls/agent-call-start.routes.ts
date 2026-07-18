import type { FastifyInstance } from "fastify";
import type { StartAiCallingAgentCallRequest } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { getAgentCallExecutionReadiness } from
  "./agent-call-execution-readiness.js";
import { evaluateAgentCallStartPolicy } from "./agent-call-gray-policy.js";
import { isStarted, toAgentCallDto as toDto } from
  "./agent-call-route-helpers.js";
import { getAgentCallUsageReadiness } from "./agent-call-usage-readiness.js";
import {
  findAgentCallDraft,
  listAgentCallDrafts,
} from "./agent-calls-runtime.repository.js";
import { startAgentCallDraft } from "./agent-call-start-runtime.js";
import {
  autonomousAgentPolicyRequired,
  evaluateAutonomousAgentPolicy,
} from "./autonomous-agent-policy.js";

export function registerAgentCallStartRoute(app: FastifyInstance) {
  app.post(
    "/ai-calling-agent/drafts/:draftId/start",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const draftId = (request.params as { draftId: string }).draftId;
      const draft = await findAgentCallDraft(account.id, draftId);
      if (!draft) {
        return sendError(
          reply,
          404,
          "agent_call_draft_not_found",
          "Draft not found",
        );
      }
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
        drafts: await listAgentCallDrafts(account.id),
      });
      if (!startPolicy.allowed) {
        return reply.status(startPolicy.statusCode).send({
          error: {
            code: `agent_call_${startPolicy.code}`,
            message: startPolicy.message,
          },
          draft: toDto(draft),
        });
      }
      if (autonomousAgentPolicyRequired()) {
        const autonomousPolicy = evaluateAutonomousAgentPolicy({
          userId: account.id,
          draft,
        });
        if (!autonomousPolicy.allowed) {
          return reply.status(403).send({
            error: {
              code: `agent_call_${autonomousPolicy.code}`,
              message: "Autonomous Agent is not enabled for this task",
            },
            draft: toDto(draft),
          });
        }
      }
      if (process.env.AGENT_CALL_GRAY_ENABLED === "true" &&
        (!draft.recipientDisclosureConfirmed ||
          !draft.disclosurePromptVersion)) {
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
      const usageReadiness = await getAgentCallUsageReadiness(account.id);
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
      const result = await startAgentCallDraft(
        account.id,
        draftId,
        request.body as StartAiCallingAgentCallRequest,
      );
      if (result.status === "mutation_conflict") {
        return sendError(
          reply,
          409,
          "agent_call_mutation_conflict",
          "Another draft operation is already in progress",
        );
      }
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
      if (result.status === "session_conflict") {
        return sendError(
          reply,
          409,
          "agent_call_session_conflict",
          "Agent call session could not be created",
        );
      }
      return { draft: toDto(result.draft) };
    },
  );
}
