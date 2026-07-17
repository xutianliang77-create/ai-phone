import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { findWorkerDispatch } from "../worker-dispatches/worker-dispatch.repository.js";
import { getReadyVoiceProfileTtsConfig } from "../voice-profiles/voice-profiles.service.js";
import { findCallLink, registerCallLeg } from "./call-links.service.js";
import { getCallLinkWorkerSupervisor } from "./call-link-worker-supervisor.js";

type RuntimeEventRequest = {
  ticket: string;
  event: "ready" | "heartbeat" | "failed" | "ending";
  workerId?: string;
  jobId?: string;
  errorClass?: string;
};

export function registerWorkerDispatchRuntimeRoutes(app: FastifyInstance) {
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
    const dispatch = findWorkerDispatch(call.sessionId);
    if (!dispatch || dispatch.generation !== claim.generation) {
      return sendError(reply, 409, "worker_dispatch_generation_conflict", "Dispatch is stale");
    }
    await registerCallLeg({
      callId: call.callId,
      participantIdentity: body.participantIdentity,
      participantRole: "worker",
      joinType: "worker",
    });
    runtime.heartbeat?.(call.callId, {
      generation: claim.generation,
      workerId: body.workerId,
      jobId: body.jobId,
    });
    const ttsVoice = getReadyVoiceProfileTtsConfig(call.userId);
    return {
      callId: call.callId,
      sessionId: call.sessionId,
      roomName: call.roomName,
      generation: claim.generation,
      participantIdentity: body.participantIdentity,
      ...(ttsVoice ? { ttsVoice } : {}),
    };
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
    if (body.event === "ready") runtime.markReady(params.callId, runtimeClaim);
    if (body.event === "heartbeat") runtime.heartbeat?.(params.callId, runtimeClaim);
    if (body.event === "failed") {
      runtime.reportFailure?.(
        params.callId,
        runtimeClaim,
        body.errorClass ?? "worker_failed",
      );
    }
    if (body.event === "ending") await runtime.stop(params.callId);
    const dispatch = findWorkerDispatch(call.sessionId);
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

function parseSnapshotRequest(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!boundedString(value.ticket, 4096) ||
    !boundedString(value.participantIdentity, 256) ||
    !boundedString(value.workerId, 128) || !boundedString(value.jobId, 128)) {
    return null;
  }
  return {
    ticket: value.ticket,
    participantIdentity: value.participantIdentity,
    workerId: value.workerId,
    jobId: value.jobId,
  };
}

function parseRequest(body: unknown): RuntimeEventRequest | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (!boundedString(value.ticket, 4096) ||
    !["ready", "heartbeat", "failed", "ending"].includes(String(value.event)) ||
    !optionalBoundedString(value.workerId, 128) ||
    !optionalBoundedString(value.jobId, 128) ||
    !optionalBoundedString(value.errorClass, 80)) return null;
  return {
    ticket: value.ticket,
    event: value.event as RuntimeEventRequest["event"],
    ...(value.workerId ? { workerId: value.workerId } : {}),
    ...(value.jobId ? { jobId: value.jobId } : {}),
    ...(value.errorClass ? { errorClass: value.errorClass } : {}),
  } as RuntimeEventRequest;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 &&
    Buffer.byteLength(value) <= maximum;
}

function optionalBoundedString(value: unknown, maximum: number) {
  return value === undefined || boundedString(value, maximum);
}

function isInternalAuthorized(authorization: string | undefined) {
  const expected = process.env.INTERNAL_API_SECRET ?? "";
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}
