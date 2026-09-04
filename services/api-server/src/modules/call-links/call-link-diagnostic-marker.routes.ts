import { createHash } from "node:crypto";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { withSessionWriteLock } from
  "../sessions/session-write-coordinator.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
import type { CallLinkDiagnosticCategory } from "./call-link-record.js";
import {
  findCallLinkTranslationState,
  recordCallLinkDiagnosticMarker,
} from "./call-link-translation-state.repository.js";
import { findTranslationDialOperation } from
  "./call-link-translation-control-support.js";
import { findCallLink } from "./call-links.service.js";

const categories = new Set<CallLinkDiagnosticCategory>([
  "cannot_hear_remote",
  "callee_cannot_hear_translation",
  "translation_incorrect",
  "unexpected_audio",
]);

export function registerCallLinkDiagnosticMarkerRoutes(app: FastifyInstance) {
  app.post("/call-links/:callId/diagnostic-marker", handleDiagnosticMarker);
}

async function handleDiagnosticMarker(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const account = await requireAccount(request, reply);
  if (!account) return;
  const callId = (request.params as { callId: string }).callId;
  const body = parseMarker(request.body);
  if (!body) {
    return sendError(reply, 400, "invalid_call_diagnostic_marker",
      "Invalid call diagnostic marker");
  }
  return withSessionWriteLock(callId, async () => {
    const call = await findCallLink(callId);
    if (!call) {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    if (call.userId !== account.id) {
      return sendError(reply, 403, "account_forbidden",
        "Account cannot access this call");
    }
    if (call.status === "ended" || Date.now() >= Date.parse(call.expiresAt)) {
      return sendError(reply, 410, "call_link_expired", "Call link expired");
    }
    const [state, dispatch, dial] = await Promise.all([
      findCallLinkTranslationState(call.sessionId),
      findWorkerDispatch(call.sessionId),
      findTranslationDialOperation(call.sessionId),
    ]);
    const id = markerId(call.sessionId, body.idempotencyKey);
    const result = await recordCallLinkDiagnosticMarker({
      sessionId: call.sessionId,
      marker: {
        id,
        category: body.category,
        createdAt: new Date().toISOString(),
        ...(state ? { controlGeneration: state.controlGeneration } : {}),
        ...(dispatch ? { dispatchGeneration: dispatch.generation } : {}),
        ...(dial ? { dialOperationId: dial.id } : {}),
      },
    });
    if (!result || result.status === "not_found") {
      return sendError(reply, 404, "session_not_found", "Session not found");
    }
    if (result.status === "payload_conflict") {
      return sendError(reply, 409, "call_diagnostic_marker_conflict",
        "Diagnostic marker conflicts");
    }
    return reply.status(202).send({
      callId: call.callId,
      sessionId: call.sessionId,
      markerId: result.marker.id,
      category: result.marker.category,
      createdAt: result.marker.createdAt,
      replayed: result.status === "replayed",
      ...(result.marker.controlGeneration === undefined ? {} : {
        controlGeneration: result.marker.controlGeneration,
      }),
      ...(result.marker.dispatchGeneration === undefined ? {} : {
        dispatchGeneration: result.marker.dispatchGeneration,
      }),
    });
  });
}

function parseMarker(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return categories.has(input.category as CallLinkDiagnosticCategory) &&
      typeof input.idempotencyKey === "string" &&
      /^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)
    ? {
        category: input.category as CallLinkDiagnosticCategory,
        idempotencyKey: input.idempotencyKey,
      }
    : null;
}

function markerId(sessionId: string, idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(`${sessionId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `diag_${digest}`;
}
