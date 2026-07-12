import type { FastifyInstance } from "fastify";
import {
  isSegmentTiming,
  isSpeakerAttribution,
  isSupportedLanguage,
  type SessionSegmentStage,
  type UpdateRealtimeSessionStateRequest,
  type UpsertSessionSegmentRequest,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  findSession,
  transitionSessionState,
  upsertSegment,
} from "../sessions/sessions.repository.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import { validateCreateRealtimeSessionRequest } from "./create-session-request.js";
import { createRealtimeSession } from "./realtime.service.js";
import { parseRealtimeDiagnostics } from "./realtime-diagnostics.js";

export async function registerRealtimeRoutes(app: FastifyInstance) {
  app.post("/realtime/sessions", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const parsed = validateCreateRealtimeSessionRequest(request.body);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.error.code, parsed.error.message);
    }

    const result = createRealtimeSession(account.id, parsed.value);
    if (!result) {
      return sendError(
        reply,
        402,
        "quota_not_enough",
        "Not enough free minutes",
      );
    }
    return result;
  });

  app.get("/realtime/sessions/:sessionId/status", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const session = findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    return {
      sessionId: session.id,
      status: session.status,
      consumedSeconds: session.consumedSeconds,
    };
  });

  app.post("/realtime/sessions/:sessionId/end", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const existing = findSession(params.sessionId);
    if (!existing)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (existing.userId !== account.id) return forbidden(reply);
    const session = completeSessionWithUsage(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    return { sessionId: session.id, status: session.status };
  });

  app.post("/internal/realtime/segments", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(
        reply,
        401,
        "internal_error",
        "Unauthorized internal request",
      );
    }

    const body = request.body as Partial<UpsertSessionSegmentRequest>;
    if (!isValidSegmentPatch(body)) {
      return sendError(reply, 400, "invalid_segments", "Invalid segment patch");
    }

    const session = upsertSegment(body.sessionId, {
      segmentId: body.segmentId,
      sourceText: body.sourceText,
      rawText: body.rawText,
      optimizedText: body.optimizedText,
      translatedText: body.translatedText,
      sourceLanguage: body.sourceLanguage,
      targetLanguage: body.targetLanguage,
      confidence: body.confidence,
      stage: body.stage,
      provider: body.provider,
      model: body.model,
      latencyMs: body.latencyMs,
      providerUsage: body.providerUsage,
      refinement: body.refinement,
      speaker: body.speaker,
      timing: body.timing,
    });
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    return { sessionId: session.id, segmentCount: session.segments.length };
  });

  app.post(
    "/internal/realtime/sessions/:sessionId/state",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }
      const params = request.params as { sessionId: string };
      const body = request.body as Partial<UpdateRealtimeSessionStateRequest>;
      if (!isInternalRealtimeState(body.status)) {
        return sendError(
          reply,
          400,
          "invalid_session_state",
          "Invalid realtime session state",
        );
      }
      const result = transitionSessionState(params.sessionId, body.status);
      if (!result) {
        return sendError(reply, 404, "session_not_found", "Session not found");
      }
      if (!result.transition.accepted) {
        return sendError(
          reply,
          409,
          "session_state_conflict",
          `Cannot change session from ${result.transition.previous} to ${body.status}`,
        );
      }
      return {
        sessionId: result.session.id,
        status: result.session.status,
        changed: result.transition.changed,
      };
    },
  );

  app.post(
    "/internal/realtime/sessions/:sessionId/end",
    async (request, reply) => {
      if (!isInternalAuthorized(request.headers.authorization)) {
        return sendError(
          reply,
          401,
          "internal_error",
          "Unauthorized internal request",
        );
      }

      const params = request.params as { sessionId: string };
      const body = request.body as Partial<{
        billableSeconds: unknown;
        diagnostics: unknown;
      }> | undefined;
      const billableSeconds = parseBillableSeconds(body?.billableSeconds);
      const diagnostics = parseRealtimeDiagnostics(body?.diagnostics);
      if (body?.diagnostics !== undefined && !diagnostics) {
        return sendError(
          reply,
          400,
          "invalid_session_diagnostics",
          "Invalid realtime session diagnostics",
        );
      }
      const session = completeSessionWithUsage(
        params.sessionId,
        {
          ...(typeof billableSeconds === "number" ? { billableSeconds } : {}),
          ...(diagnostics ? { diagnostics } : {}),
        },
      );
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      return { sessionId: session.id, status: session.status };
    },
  );
}

function isValidSegmentPatch(
  body: Partial<UpsertSessionSegmentRequest>,
): body is UpsertSessionSegmentRequest {
  return (
    typeof body.sessionId === "string" &&
    typeof body.segmentId === "string" &&
    (typeof body.sourceText === "string" ||
      typeof body.rawText === "string" ||
      typeof body.optimizedText === "string" ||
      typeof body.translatedText === "string" ||
      hasSegmentDiagnostics(body)) &&
    isOptionalLanguage(body.sourceLanguage) &&
    isOptionalLanguage(body.targetLanguage) &&
    isOptionalRatio(body.confidence) &&
    isOptionalStage(body.stage) &&
    isOptionalString(body.provider) &&
    isOptionalString(body.model) &&
    isOptionalNonNegativeNumber(body.latencyMs) &&
    isProviderUsage(body.providerUsage) &&
    isRefinement(body.refinement) &&
    (body.speaker === undefined || isSpeakerAttribution(body.speaker)) &&
    (body.timing === undefined || isSegmentTiming(body.timing))
  );
}

function hasSegmentDiagnostics(body: Partial<UpsertSessionSegmentRequest>) {
  return [
    body.sourceLanguage,
    body.targetLanguage,
    body.confidence,
    body.stage,
    body.provider,
    body.model,
    body.latencyMs,
    body.providerUsage,
    body.refinement,
    body.speaker,
    body.timing,
  ].some((value) => value !== undefined);
}

function isOptionalLanguage(value: unknown) {
  return value === undefined || (typeof value === "string" && isSupportedLanguage(value));
}

function isOptionalRatio(value: unknown) {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}

function isOptionalStage(value: unknown): value is SessionSegmentStage | undefined {
  return value === undefined ||
    (typeof value === "string" && segmentStages.has(value as SessionSegmentStage));
}

function isOptionalString(value: unknown) {
  return value === undefined ||
    (typeof value === "string" && value.trim().length > 0);
}

function isOptionalNonNegativeNumber(value: unknown) {
  return value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isProviderUsage(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const usage = value as { provider?: unknown };
  return typeof usage.provider === "string" && usage.provider.trim().length > 0;
}

function isRefinement(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const refinement = value as {
    provider?: unknown;
    promptVersion?: unknown;
    confidence?: unknown;
    latencyMs?: unknown;
    operations?: unknown;
    protectedTermsKept?: unknown;
    warnings?: unknown;
  };
  return (
    isOptionalString(refinement.provider) &&
    isOptionalString(refinement.promptVersion) &&
    typeof refinement.provider === "string" &&
    typeof refinement.promptVersion === "string" &&
    isOptionalRatio(refinement.confidence) &&
    isOptionalNonNegativeNumber(refinement.latencyMs) &&
    isStringArray(refinement.operations) &&
    isStringArray(refinement.protectedTermsKept) &&
    isStringArray(refinement.warnings)
  );
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const segmentStages = new Set<SessionSegmentStage>([
  "connection",
  "asr",
  "translation",
  "tts",
  "worker",
  "session",
  "provider",
]);

function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}

function parseBillableSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function isInternalRealtimeState(
  value: unknown,
): value is UpdateRealtimeSessionStateRequest["status"] {
  return value === "active" || value === "paused" || value === "failed";
}

function forbidden(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    403,
    "account_forbidden",
    "Account cannot access this resource",
  );
}
