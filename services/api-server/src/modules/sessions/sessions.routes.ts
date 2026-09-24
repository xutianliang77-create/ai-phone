import { parseExportFormat, createTextTranslationSession, isValidTextTranslationBody, isInternalAuthorized, forbidden } from "./sessions-route-helpers.js";
import type { FastifyInstance } from "fastify";
import type {
  GenerateSessionReviewRequest,
  SaveSessionSegmentsRequest,
  SaveTextTranslationSessionRequest,
  SaveTypeToSpeakSessionRequest,
} from "@translation/contracts";
import { matchesRealtimeResultOperation } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { getUsageBalance,renewUsageHold } from "../usage/usage-hold-runtime.service.js";
import {
  deleteSession,
  findSession,
  listSessions,
  saveSessionReview,
  saveSegments
} from "./sessions-runtime.repository.js";
import {
  toSessionDetail,
  toSessionExport,
  toSessionListItem,
} from "./session-mappers.js";
import {
  generatePublicSemanticReview,
  generateSessionReview,
  PublicSemanticReviewUnavailableError,
  sessionReviewSourceFingerprint,
} from "./session-review.js";
import { refundSessionUsage } from "./session-usage-refund.js";
import { registerSessionSpeakerRoutes } from "./session-speakers.routes.js";
import { registerSessionReviewActionRoutes } from "./session-review-actions.routes.js";
import {parseDeviceRulesReview} from "./session-device-rules-review.js";
import {listPublicModelAttempts} from "./public-model-attempt-list.js";
import { withSessionWriteLock } from "./session-write-coordinator.js";
import { buildSessionQualityReport } from "./session-quality-report.js";
import { handleResultSync, registerResultSyncConsentRoute } from "./session-result-sync.routes.js";

export async function registerSessionsRoutes(app: FastifyInstance) {
  registerResultSyncConsentRoute(app);
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
    if (!matchesRealtimeResultOperation(body, "sync")) {
      return sendError(reply, 409, "realtime_operation_mismatch",
        "Finalization payloads cannot use the result synchronization endpoint");
    }
    if (body.sync !== undefined || body.operation === "sync") {
      return handleResultSync(reply, params.sessionId, account.id, body);
    }
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
      if (existing.processingAuthorization) return sendError(reply, 409,
        "versioned_result_sync_required", "Versioned sessions require authorized result synchronization");
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
    const body = request.body as Partial<GenerateSessionReviewRequest> | undefined;
    const generationKind = body?.generationKind;
    if (generationKind !== undefined && generationKind !== "public_semantic_enhancement" && generationKind !== "device_rules") {
      return sendError(reply, 400, "invalid_session_review_request",
        "Unsupported review generation kind");
    }
    try {
      return await withSessionWriteLock(session.id, async () => {
        const current = await findSession(session.id);
        if (!current)
          return sendError(reply, 404, "session_not_found", "Session not found");
        if (current.userId !== account.id) return forbidden(reply);
        if(generationKind==="device_rules"){
          if(!current.processingAuthorization||!body||Object.keys(body).some(key=>!["generationKind","review"].includes(key))) {
            return sendError(reply,400,"invalid_device_rules_review","Device rules require a versioned session and explicit review");
          }
          const deviceReview=parseDeviceRulesReview("review" in body?body.review:undefined,current);
          if(!deviceReview)return sendError(reply,400,"invalid_device_rules_review","Device rule evidence does not match an ended session");
          if(current.review?.generationKind==="public_semantic_enhancement"||
            current.review?.generationKind==="device_rules"&&current.review.sourceFingerprint===deviceReview.sourceFingerprint){
            return toSessionDetail(current);
          }
          const updated=await saveSessionReview(current.id,deviceReview);
          return toSessionDetail(updated??current);
        }
        // Versioned sessions are the 1.1 public processing path.  Its model
        // configuration deliberately covers ASR/MT/TTS only; a generic LLM
        // review provider could therefore be a private legacy configuration.
        // Keep the phone-side rule review available, but fail closed until a
        // separately qualified public semantic-review configuration exists.
        if (current.processingAuthorization) {
          return sendError(reply, 409, "public_semantic_review_not_configured",
            "Public semantic review requires a separately qualified public model");
        }
        if (generationKind === "public_semantic_enhancement" &&
            current.review?.generationKind === "public_semantic_enhancement" &&
            current.review.sourceFingerprint === sessionReviewSourceFingerprint(current)) {
          return toSessionDetail(current);
        }
        const review = generationKind === "public_semantic_enhancement"
          ? await generatePublicSemanticReview(current)
          : await generateSessionReview(current);
        const updated = await saveSessionReview(current.id, review);
        return toSessionDetail(updated ?? current);
      });
    } catch (error) {
      if (error instanceof PublicSemanticReviewUnavailableError) {
        return sendError(reply, 409, "public_semantic_review_unavailable", error.message);
      }
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

  app.post("/internal/usage/allowance/:sessionId", async(request,reply)=>{
    if(!isInternalAuthorized(request.headers.authorization)){
      return sendError(reply,401,"internal_error","Unauthorized internal request");
    }
    const sessionId=(request.params as {sessionId:string}).sessionId,body=request.body;
    if(!body||typeof body!=="object"||Array.isArray(body)||
      Object.keys(body).length!==1||!Object.hasOwn(body,"targetSeconds")||
      !Number.isSafeInteger((body as {targetSeconds?:unknown}).targetSeconds)||
      (body as {targetSeconds:number}).targetSeconds<1||
      (body as {targetSeconds:number}).targetSeconds>2_147_483_647){
      return sendError(reply,400,"invalid_usage_allowance","targetSeconds is required");
    }
    const session=await findSession(sessionId);
    if(!session||session.processingAuthorization?.processingMode!=="online"||
      !session.publicRealtimeIssuance||!session.publicRuntime||session.publicRuntime.stoppedAt||
      !["active","paused"].includes(session.status)){
      return sendError(reply,409,"public_usage_session_not_active","No active public session");
    }
    const result=await renewUsageHold(session.userId,sessionId,(body as {targetSeconds:number}).targetSeconds);
    if(!result.hold)return sendError(reply,409,"public_usage_hold_not_active","No active account reservation");
    return {status:result.status,authorizedSeconds:result.hold.seconds,
      remainingSeconds:result.balance.remainingSeconds,availableSeconds:result.balance.availableSeconds};
  });

  app.get("/internal/sessions/:sessionId/model-attempts", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    const { sessionId } = request.params as { sessionId: string };
    const session = await findSession(sessionId);
    if (!session) return sendError(reply, 404, "session_not_found", "Session not found");
    const query = request.query as { cursor?: string; limit?: string };
    try {
      return await listPublicModelAttempts(session, {
        cursor: query.cursor,
        limit: query.limit === undefined ? undefined : Number(query.limit),
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("invalid_model_attempt_")) {
        return sendError(reply, 400, error.message, "Invalid model attempt cursor or limit");
      }
      throw error;
    }
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
