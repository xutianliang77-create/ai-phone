import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  SaveSessionSegmentsRequest,
  SaveTextTranslationSessionRequest,
  SaveTypeToSpeakSessionRequest,
} from "@translation/contracts";
import { isSupportedLanguage } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { getUsageBalance } from "../usage/usage-hold-runtime.service.js";
import {
  createSession,
  deleteSession,
  findSession,
  listSessions,
  saveSessionReview,
  saveSegments,
} from "./sessions-runtime.repository.js";
import {
  toSessionDetail,
  toSessionExport,
  toSessionListItem,
} from "./session-mappers.js";
import {
  generateSessionReview,
} from "./session-review.js";
import { refundSessionUsage } from "./session-usage-refund.js";
import { registerSessionSpeakerRoutes } from "./session-speakers.routes.js";
import { registerSessionReviewActionRoutes } from "./session-review-actions.routes.js";
import { withSessionWriteLock } from "./session-write-coordinator.js";
import { buildSessionQualityReport } from "./session-quality-report.js";

export async function registerSessionsRoutes(app: FastifyInstance) {
  registerSessionSpeakerRoutes(app);
  registerSessionReviewActionRoutes(app);
  app.get("/sessions", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const query = request.query as { q?: string };
    return {
      sessions: (await listSessions(account.id, query.q)).map(toSessionListItem),
    };
  });

  app.post("/sessions/type-to-speak", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const body = request.body as Partial<SaveTypeToSpeakSessionRequest>;
    if (!isValidTextTranslationBody(body, true)) {
      return sendError(
        reply,
        400,
        "invalid_type_to_speak_session",
        "sourceText and translatedText are required",
      );
    }

    return reply
      .status(201)
      .send(
        toSessionDetail(
          await createTextTranslationSession(account.id, body, "type_to_speak"),
        ),
      );
  });

  app.post("/sessions/text-translation", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const body = request.body as Partial<SaveTextTranslationSessionRequest>;
    if (!isValidTextTranslationBody(body, false)) {
      return sendError(
        reply,
        400,
        "invalid_text_translation_session",
        "sourceText is required",
      );
    }

    return reply
      .status(201)
      .send(
        toSessionDetail(
          await createTextTranslationSession(
            account.id,
            body,
            body.sourceKind ?? "text",
          ),
        ),
      );
  });

  app.get("/sessions/:sessionId", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const session = await findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    return toSessionDetail(session);
  });

  app.get("/sessions/:sessionId/quality-report", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const session = await findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    return buildSessionQualityReport(session);
  });

  app.post("/sessions/:sessionId/segments", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const body = request.body as Partial<SaveSessionSegmentsRequest>;
    if (!Array.isArray(body.segments)) {
      return sendError(
        reply,
        400,
        "invalid_segments",
        "segments must be an array",
      );
    }
    return withSessionWriteLock(params.sessionId, async () => {
      const existing = await findSession(params.sessionId);
      if (!existing)
        return sendError(reply, 404, "session_not_found", "Session not found");
      if (existing.userId !== account.id) return forbidden(reply);
      const session = await saveSegments(params.sessionId, body.segments!);
      return toSessionDetail(session ?? existing);
    });
  });

  app.post("/sessions/:sessionId/review", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const session = await findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    try {
      const review = await generateSessionReview(session);
      return withSessionWriteLock(session.id, async () => {
        const current = await findSession(session.id);
        if (!current)
          return sendError(reply, 404, "session_not_found", "Session not found");
        if (current.userId !== account.id) return forbidden(reply);
        const updated = await saveSessionReview(current.id, review);
        return toSessionDetail(updated ?? current);
      });
    } catch (error) {
      return sendError(
        reply,
        502,
        "session_review_generation_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  app.delete("/sessions/:sessionId", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    return withSessionWriteLock(params.sessionId, async () => {
      const session = await findSession(params.sessionId);
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      if (session.userId !== account.id) return forbidden(reply);
      if (!await deleteSession(params.sessionId)) {
        return sendError(reply, 404, "session_not_found", "Session not found");
      }
      reply.status(204);
      return null;
    });
  });

  app.get("/sessions/:sessionId/export", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const query = request.query as { format?: string };
    const session = await findSession(params.sessionId);
    if (!session)
      return sendError(reply, 404, "session_not_found", "Session not found");
    if (session.userId !== account.id) return forbidden(reply);
    const format = parseExportFormat(query.format);
    return toSessionExport(session, format);
  });

  app.get("/usage/balance", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    return { ...(await getUsageBalance(account.id)) };
  });

  app.get("/internal/usage/balance/:userId", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(
        reply,
        401,
        "internal_error",
        "Unauthorized internal request",
      );
    }
    const params = request.params as { userId: string };
    return { ...(await getUsageBalance(params.userId)) };
  });

  app.post("/internal/sessions/:sessionId/refund", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(
        reply,
        401,
        "internal_error",
        "Unauthorized internal request",
      );
    }

    const params = request.params as { sessionId: string };
    const body = request.body as Partial<{ reason: unknown }> | undefined;
    return withSessionWriteLock(params.sessionId, async () => {
      const session = await findSession(params.sessionId);
      if (!session)
        return sendError(reply, 404, "session_not_found", "Session not found");
      const refund = await refundSessionUsage(session, { reason: body?.reason });
      return {
        sessionId: session.id,
        refundedSeconds: refund.refundedSeconds,
        reason: refund.reason,
        idempotencyKey: refund.idempotencyKey,
        balance: refund.balance,
        ledgerId: refund.ledger?.id,
      };
    });
  });
}

function parseExportFormat(format: string | undefined) {
  if (format === "txt" || format === "json" || format === "csv") return format;
  return "markdown";
}

function createTextTranslationSession(
  userId: string,
  body: SaveTextTranslationSessionRequest,
  sourceKind: "type_to_speak" | "scan" | "text",
) {
  const sourceText = body.sourceText.trim();
  const translatedText = body.translatedText?.trim() ?? "";
  const now = new Date().toISOString();
  return createSession({
    id: randomUUID(),
    userId,
    mode: "conversation",
    status: "ended",
    consumedSeconds: 0,
    createdAt: now,
    endedAt: now,
    segments: [
      {
        id: `${sourceKind}_1`,
        sourceText,
        translatedText,
        sourceLanguage: body.sourceLanguage ?? "auto",
        targetLanguage: body.targetLanguage ?? "auto",
        stage: "translation",
        provider: sourceKind,
        model: `${body.sourceLanguage ?? "auto"}->${body.targetLanguage ?? "auto"}`,
        providerUsage: {
          provider: sourceKind,
          model: `${body.sourceLanguage ?? "auto"}->${body.targetLanguage ?? "auto"}`,
          inputCharacters: sourceText.length,
          outputCharacters: translatedText.length,
        },
      },
    ],
  });
}

function isValidTextTranslationBody(
  body: Partial<SaveTextTranslationSessionRequest>,
  requireTranslation: boolean,
): body is SaveTextTranslationSessionRequest {
  return (
    typeof body.sourceText === "string" &&
    body.sourceText.trim().length > 0 &&
    isOptionalText(body.translatedText) &&
    (!requireTranslation || (body.translatedText?.trim().length ?? 0) > 0) &&
    isOptionalLanguage(body.sourceLanguage) &&
    isOptionalLanguage(body.targetLanguage) &&
    isOptionalSourceKind(body.sourceKind)
  );
}

function isOptionalText(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isOptionalSourceKind(value: unknown) {
  return (
    value === undefined ||
    value === "type_to_speak" ||
    value === "scan" ||
    value === "text"
  );
}

function isOptionalLanguage(value: unknown) {
  return value === undefined || (typeof value === "string" && isSupportedLanguage(value));
}

function isInternalAuthorized(authorization: string | undefined) {
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return authorization === `Bearer ${secret}`;
}

function forbidden(reply: Parameters<typeof sendError>[0]) {
  return sendError(
    reply,
    403,
    "account_forbidden",
    "Account cannot access this resource",
  );
}
