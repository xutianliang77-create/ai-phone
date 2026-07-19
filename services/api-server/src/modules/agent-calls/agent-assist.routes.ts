import type { FastifyInstance } from "fastify";
import type {
  AgentAssistSuggestionDto,
  AgentAssistTurnDto,
  RequestAgentAssistSuggestion,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  generateAgentAssistSuggestion,
  getAgentAssistReadiness,
} from "./agent-assist-provider.js";
import {
  appendAgentStep,
  beginAgentRun,
  findAgentStepByIdempotency,
  updateAgentRun,
} from "./agent-orchestration-runtime.repository.js";
import { findAgentCallDraft } from "./agent-calls-runtime.repository.js";

export function registerAgentAssistRoutes(app: FastifyInstance) {
  app.post(
    "/ai-calling-agent/drafts/:draftId/assist/suggestions",
    async (request, reply) => {
      const account = await requireAccount(request, reply);
      if (!account) return;
      const input = parseSuggestionRequest(request.body);
      if (!input) {
        return sendError(reply, 400, "invalid_agent_assist_request", "Invalid assist request");
      }
      if (!input.humanPresent) {
        return sendError(
          reply,
          409,
          "agent_assist_human_required",
          "Agent Assist requires the user to remain present",
        );
      }
      const readiness = getAgentAssistReadiness();
      if (readiness.status === "disabled") {
        return reply.status(503).send({
          error: { code: "agent_assist_disabled", message: "Agent Assist is disabled" },
          readiness,
        });
      }
      const draft = await findAgentCallDraft(
        account.id,
        (request.params as { draftId: string }).draftId,
      );
      if (!draft) {
        return sendError(reply, 404, "agent_call_draft_not_found", "Draft not found");
      }
      if (!["authorized", "queued", "in_progress"].includes(draft.status)) {
        return sendError(
          reply,
          409,
          "agent_assist_not_authorized",
          "Draft must be authorized before Agent Assist",
        );
      }
      const begun = await beginAgentRun({
        taskId: draft.id,
        sessionId: draft.callId,
        mode: "assist",
        policyVersion: process.env.VOICE_AGENT_POLICY_VERSION ?? "agent-assist-v1",
        modelProfileId: process.env.VOICE_AGENT_LLM_MODEL,
      });
      if (!("run" in begun)) {
        return sendError(reply, 409, "agent_assist_run_conflict", "Agent run unavailable");
      }
      const replay = await findAgentStepByIdempotency(begun.run.id, input.idempotencyKey);
      if (replay) {
        return {
          run: begun.run,
          step: publicStep(replay),
          suggestion: storedSuggestion(replay.outputSummary, draft.suggestedScript),
          replayed: true,
        };
      }
      await updateAgentRun({ runId: begun.run.id, status: "running" });
      const generated = await generateAgentAssistSuggestion({
        draft,
        latestUtterance: input.latestUtterance,
        recentTurns: input.recentTurns,
      });
      const appended = await appendAgentStep({
        runId: begun.run.id,
        decisionType: "suggest_response",
        inputTurnId: input.inputTurnId,
        outputSummary: JSON.stringify(generated.suggestion),
        latencyMs: generated.latencyMs,
        idempotencyKey: input.idempotencyKey,
      });
      if (!("step" in appended)) {
        return sendError(reply, 409, "agent_assist_step_conflict", "Agent step unavailable");
      }
      return {
        run: begun.run,
        step: publicStep(appended.step),
        suggestion: generated.suggestion,
        replayed: appended.status === "replayed",
      };
    },
  );
}

function parseSuggestionRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const input = body as Partial<RequestAgentAssistSuggestion>;
  if (input.humanPresent !== true || !bounded(input.inputTurnId, 120) ||
    !bounded(input.latestUtterance, 1_000) || !bounded(input.idempotencyKey, 128)) {
    return null;
  }
  const recentTurns = parseRecentTurns(input.recentTurns);
  if (recentTurns === null) return null;
  return {
    humanPresent: true,
    inputTurnId: input.inputTurnId,
    latestUtterance: input.latestUtterance,
    idempotencyKey: input.idempotencyKey,
    recentTurns,
  };
}

function parseRecentTurns(value: unknown): AgentAssistTurnDto[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6) return null;
  const turns: AgentAssistTurnDto[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const turn = item as Record<string, unknown>;
    if (!["user", "remote"].includes(String(turn.speakerRole)) ||
      !bounded(turn.text, 1_000)) return null;
    turns.push({
      speakerRole: turn.speakerRole as AgentAssistTurnDto["speakerRole"],
      text: turn.text,
    });
  }
  return turns;
}

function storedSuggestion(value: string | undefined, fallback: string) {
  try {
    return JSON.parse(value ?? "") as AgentAssistSuggestionDto;
  } catch {
    return {
      text: fallback.slice(0, 300),
      intent: "approved_script",
      warnings: ["replay_payload_unavailable"],
      requiresUserAction: true as const,
      source: "script_fallback" as const,
    };
  }
}

function publicStep<T extends { outputSummary?: string }>(step: T) {
  const suggestion = storedSuggestion(step.outputSummary, "");
  return { ...step, outputSummary: suggestion.text };
}

function bounded(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value) <= maximum;
}
