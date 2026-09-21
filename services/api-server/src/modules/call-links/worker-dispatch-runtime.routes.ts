import { type CallLinkWorkerTtsCredentialAccess, verifyBoundWorker, parseWorkerBindingRequest, parseWorkerAttemptRequest, isTerminalAttempt, persistCallLinkPublicTtsAttempt, validateWorkerTtsCredentialAccess, workerTtsCredentialAuthorized, sendRuntimeError, parseSnapshotRequest, parseRequest, isInternalAuthorized } from "./worker-dispatch-runtime-helpers.js";
import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { observeRealtimeRuntime } from "../../infrastructure/observability/realtime-prometheus.js";
import { findWorkerDispatch } from "../worker-dispatches/worker-dispatch-runtime.repository.js";
import { parseRealtimeNodeDiagnostics } from "../realtime/realtime-node-diagnostics.js";
import { mergeSessionNodeDiagnostics } from "../sessions/session-diagnostics-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import {
  findSession
} from "../sessions/sessions-runtime.repository.js";
import { getCallLinkTtsVoice } from "./call-link-tts-voice.js";
import { findCallLinkTranslationState } from "./call-link-translation-state.repository.js";
import { findCallLink, registerCallLeg } from "./call-links.service.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";
import {
  callLinkPublicTtsProfile,
  parseCallLinkPublicTtsAttempt, resolveCallLinkPublicTtsMaterial,
  type CallLinkPublicTtsCapability
} from "./call-link-public-tts.js";
export { type CallLinkWorkerTtsCredentialAccess } from "./worker-dispatch-runtime-helpers.js";

export interface WorkerDispatchRuntimeRoutesOptions {
  publicTtsCapability?: CallLinkPublicTtsCapability;
  workerTtsCredentialAccess?: CallLinkWorkerTtsCredentialAccess;
}

export function registerWorkerDispatchRuntimeRoutes(
  app: FastifyInstance,
  options: WorkerDispatchRuntimeRoutesOptions = {},
) {
  const workerTtsCredentialAccess = options.workerTtsCredentialAccess;
  validateWorkerTtsCredentialAccess(workerTtsCredentialAccess);
  app.post("/internal/call-links/:callId/diagnostics", {
    bodyLimit: 128 * 1024,
  }, async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    const params = request.params as { callId: string };
    const body = request.body as { version?: unknown; node?: unknown } | undefined;
    const node = body?.version === 1
      ? parseRealtimeNodeDiagnostics(body.node) : undefined;
    if (!node) {
      return sendError(
        reply,
        400,
        "invalid_worker_diagnostics",
        "Invalid Worker diagnostics",
      );
    }
    const call = await findCallLink(params.callId);
    if (!call) {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    return withSessionWriteLock(call.sessionId, async () => {
      const session = await mergeSessionNodeDiagnostics(call.sessionId, node);
      if (!session) {
        return sendError(reply, 404, "session_not_found", "Session not found");
      }
      observeRealtimeRuntime(node);
      return {
        callId: call.callId,
        sessionId: call.sessionId,
        runtimeId: node.runtimeId,
        nodeCount: session.diagnostics?.nodes?.length ?? 0,
      };
    });
  });

  app.post("/internal/call-links/:callId/worker-snapshot", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    const params = request.params as { callId: string };
    const body = parseSnapshotRequest(request.body);
    if (!body) {
      return sendError(reply, 400, "invalid_worker_snapshot_request", "Invalid snapshot request");
    }
    const runtime = getCallLinkWorkerSupervisor();
    const claim = runtime.verifyTicket?.(body.ticket);
    const call = await findCallLink(params.callId);
    if (!claim || !call || claim.callId !== params.callId ||
      claim.sessionId !== call.sessionId || claim.roomName !== call.roomName) {
      return sendError(reply, 403, "worker_runtime_binding_conflict", "Worker binding failed");
    }
    const dispatch = await findWorkerDispatch(call.sessionId);
    if (!dispatch || dispatch.generation !== claim.generation) {
      return sendError(reply, 409, "worker_dispatch_generation_conflict", "Dispatch is stale");
    }
    await registerCallLeg({
      callId: call.callId,
      participantIdentity: body.participantIdentity,
      participantRole: "worker",
      joinType: "worker",
    });
    await runtime.heartbeat?.(call.callId, {
      generation: claim.generation,
      workerId: body.workerId,
      jobId: body.jobId,
    });
    const workerSession = await findSession(call.sessionId);
    if (!workerSession) {
      return sendError(reply, 404, "session_not_found", "Session not found");
    }
    const publicTts = callLinkPublicTtsProfile(workerSession.callLink?.publicTts);
    const ttsVoice = publicTts ? {
      mode: "preset" as const,
      presetId: publicTts.voice,
      quality: "standard" as const,
    } : await getCallLinkTtsVoice(call.userId);
    const translationControl = await findCallLinkTranslationState(
      call.sessionId,
    );
    return {
      callId: call.callId,
      sessionId: call.sessionId,
      roomName: call.roomName,
      generation: claim.generation,
      participantIdentity: body.participantIdentity,
      ttsVoice,
      ...(translationControl ? {
        translationControl: {
          sourceLanguage: translationControl.sourceLanguage,
          targetLanguage: translationControl.targetLanguage,
          uplinkPaused: translationControl.uplinkPaused,
          controlGeneration: translationControl.controlGeneration,
        },
      } : {}),
      ...(publicTts ? {
        publicTts,
      } : {}),
    };
  });

  app.post("/internal/call-links/:callId/worker-tts-material", {
    bodyLimit: 4096,
  }, async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    if (!workerTtsCredentialAuthorized(
      request.headers["x-wujie-worker-tts-credential"],
      workerTtsCredentialAccess,
    )) {
      return sendError(reply, 403, "call_link_worker_tts_credential_denied",
        "Worker TTS credential denied");
    }
    const body = parseWorkerBindingRequest(request.body);
    if (!body) {
      return sendError(reply, 400, "invalid_call_link_worker_tts_material",
        "Invalid Worker TTS material request");
    }
    const callId = (request.params as { callId: string }).callId;
    return withSessionWriteLock(callId, async () => {
      const bound = await verifyBoundWorker(callId, body);
      if (!bound.ok) return sendError(reply, bound.status, bound.code, bound.message);
      try {
        const resolved = resolveCallLinkPublicTtsMaterial(
          bound.session.callLink?.publicTts,
          options.publicTtsCapability,
        );
        return {
          callId,
          sessionId: bound.call.sessionId,
          generation: bound.dispatch.generation,
          workerId: body.workerId,
          jobId: body.jobId,
          profile: resolved.profile,
          credentials: resolved.credentials,
        };
      } catch (error) {
        return sendRuntimeError(reply, error);
      }
    });
  });

  app.post("/internal/call-links/:callId/worker-tts-attempt", {
    bodyLimit: 8192,
  }, async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    if (!workerTtsCredentialAuthorized(
      request.headers["x-wujie-worker-tts-credential"],
      workerTtsCredentialAccess,
    )) {
      return sendError(reply, 403, "call_link_worker_tts_credential_denied",
        "Worker TTS credential denied");
    }
    const body = parseWorkerAttemptRequest(request.body);
    if (!body) {
      return sendError(reply, 400, "invalid_call_link_worker_tts_attempt",
        "Invalid Worker TTS attempt request");
    }
    const callId = (request.params as { callId: string }).callId;
    return withSessionWriteLock(callId, async () => {
      const bound = await verifyBoundWorker(callId, body, {
        allowTerminalAttempt: isTerminalAttempt(body.event),
      });
      if (!bound.ok) return sendError(reply, bound.status, bound.code, bound.message);
      try {
        const event = parseCallLinkPublicTtsAttempt(
          body.event,
          bound.session.callLink?.publicTts,
          callId,
        );
        const ack = await persistCallLinkPublicTtsAttempt({
          callId,
          event,
          capability: options.publicTtsCapability,
        });
        return ack;
      } catch (error) {
        return sendRuntimeError(reply, error);
      }
    });
  });

  app.post("/internal/call-links/:callId/worker-runtime", async (request, reply) => {
    if (!isInternalAuthorized(request.headers.authorization)) {
      return sendError(reply, 401, "internal_error", "Unauthorized internal request");
    }
    const params = request.params as { callId: string };
    const body = parseRequest(request.body);
    if (!body) {
      return sendError(reply, 400, "invalid_worker_runtime_event", "Invalid Worker event");
    }
    const runtime = getCallLinkWorkerSupervisor();
    const claim = runtime.verifyTicket?.(body.ticket);
    const call = await findCallLink(params.callId);
    if (!claim || !call || claim.callId !== params.callId ||
      claim.sessionId !== call.sessionId || claim.roomName !== call.roomName) {
      return sendError(reply, 403, "worker_runtime_binding_conflict", "Worker event binding failed");
    }
    const runtimeClaim = {
      generation: claim.generation,
      ...(body.workerId ? { workerId: body.workerId } : {}),
      ...(body.jobId ? { jobId: body.jobId } : {}),
    };
    if (body.event === "ready") await runtime.markReady(params.callId, runtimeClaim);
    if (body.event === "heartbeat") {
      await runtime.heartbeat?.(params.callId, runtimeClaim);
    }
    if (body.event === "failed") {
      await runtime.reportFailure?.(
        params.callId,
        runtimeClaim,
        body.errorClass ?? "worker_failed",
      );
    }
    if (body.event === "ending") await runtime.stop(params.callId);
    const dispatch = await findWorkerDispatch(call.sessionId);
    if (!dispatch || dispatch.generation !== claim.generation) {
      return sendError(reply, 409, "worker_dispatch_generation_conflict", "Dispatch is stale");
    }
    return {
      callId: call.callId,
      sessionId: call.sessionId,
      generation: dispatch.generation,
      status: dispatch.status,
      leaseExpiresAt: dispatch.leaseExpiresAt,
    };
  });
}
