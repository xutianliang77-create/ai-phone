import type { FastifyInstance } from "fastify";
import type {
  FinalizeRealtimeSessionRequest,
  SessionSegmentDto,
} from "@translation/contracts";
import { matchesRealtimeResultOperation } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { completeSessionWithUsage } from "../sessions/session-completion.js";
import {
  findSession,
  markSessionFinalized,
  saveSegments,
} from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import {handlePublicFinalization,registerPublicLifecycleRoutes} from "./public-session-lifecycle.routes.js";

export function registerRealtimeFinalizationRoute(app: FastifyInstance) {
  registerPublicLifecycleRoutes(app);
  app.post("/realtime/sessions/:sessionId/finalize", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { sessionId: string };
    const body = request.body as Partial<FinalizeRealtimeSessionRequest>;
    if (!matchesRealtimeResultOperation(body, "finalize")) {
      return sendError(reply, 409, "realtime_operation_mismatch",
        "Result synchronization cannot finalize a session");
    }
    if (body.stopWatermark !== undefined || (body as Record<string,unknown>).contractVersion!==undefined ||
        (body as Record<string,unknown>).deploymentId!==undefined) {
      return handlePublicFinalization(reply,params.sessionId,account.id,body);
    }
    const idempotencyKey = `finalize:${params.sessionId}`;
    if (body.sessionId !== params.sessionId ||
        body.idempotencyKey !== idempotencyKey) {
      return sendError(reply, 409, "session_finalization_binding_conflict",
        "Finalization session id and idempotency key must match");
    }
    if (!isValidSegments(body.segments)) {
      return sendError(reply, 400, "invalid_segments",
        "Finalization segments are invalid");
    }
    const billableSeconds = parseBillableSeconds(body.billableSeconds);
    if (billableSeconds === undefined) {
      return sendError(reply, 400, "invalid_billable_seconds",
        "billableSeconds must be a non-negative number");
    }

    return withSessionWriteLock(params.sessionId, async () => {
      const existing = await findSession(params.sessionId);
      if (!existing) {
        return sendError(reply, 404, "session_not_found", "Session not found");
      }
      if (existing.userId !== account.id) {
        return sendError(reply, 403, "account_forbidden",
          "Account cannot access this resource");
      }
      if (existing.finalizationIdempotencyKey === idempotencyKey) {
        return response(existing, idempotencyKey);
      }
      if (existing.processingAuthorization) {
        return sendError(reply, 503, "versioned_finalization_not_ready",
          "Public session metering and stop-watermark finalization are not available yet");
      }
      if (existing.finalizationIdempotencyKey) {
        return sendError(reply, 409, "session_already_finalized",
          "Session was finalized with another idempotency key");
      }

      await saveSegments(params.sessionId, body.segments!);
      const session = await completeSessionWithUsage(params.sessionId, {
        billableSeconds,
      });
      if (!session) {
        return sendError(reply, 404, "session_not_found", "Session not found");
      }
      await markSessionFinalized(params.sessionId, idempotencyKey);
      return response(session, idempotencyKey);
    });
  });
}

function response(
  session: { id: string; status: string; consumedSeconds: number },
  idempotencyKey: string,
) {
  return {
    sessionId: session.id,
    status: session.status,
    consumedSeconds: session.consumedSeconds,
    idempotencyKey,
  };
}

function isValidSegments(value: unknown): value is SessionSegmentDto[] {
  return Array.isArray(value) && value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const segment = item as Partial<SessionSegmentDto>;
    return typeof segment.id === "string" &&
      typeof segment.sourceText === "string" &&
      typeof segment.translatedText === "string";
  });
}

function parseBillableSeconds(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}
