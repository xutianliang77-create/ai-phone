import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  enterpriseMeetingScreenOcrTopic,
  type EnterpriseMeetingScreenOcrLayoutEvent,
} from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitRoomProviderAdapter } from
  "../call-links/livekit-room-provider-adapter.js";
import { enterpriseRequestTraceId } from "./enterprise-auth.js";
import {
  issueEnterpriseMeetingScreenOcrTicket,
  screenOcrTicketSecret,
  verifyEnterpriseMeetingScreenOcrTicket,
} from "./enterprise-meeting-screen-ocr-ticket.js";
import {
  parseScreenOcrClaim,
  parseScreenOcrComplete,
  parseScreenOcrFail,
  parseScreenOcrRunFail,
  parseScreenOcrTicketBody,
} from "./enterprise-meeting-screen-ocr-route-input.js";
import { screenOcrLayout } from
  "./enterprise-meeting-screen-ocr-route-output.js";
import type { EnterpriseRepositoryRuntime } from
  "./enterprise-repository-runtime.js";

export function registerEnterpriseMeetingScreenOcrWorkerRoutes(
  app: FastifyInstance,
  runtime: EnterpriseRepositoryRuntime,
) {
  app.post("/internal/enterprise/meeting-screen-ocr/snapshot",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const parsed = parseScreenOcrTicketBody(request.body);
      const ticket = parsed ? ticketPayload(parsed.ticket) : null;
      if (!ticket) return rejectedTicket(reply);
      if (!runtime.acceptMeetingScreenOcrWorker) return postgresRequired(reply);
      const result = await runtime.acceptMeetingScreenOcrWorker({
        payload: ticket, traceId: enterpriseRequestTraceId(request), now: new Date(),
      });
      return result.status === "accepted"
        ? reply.send({ status: "accepted", run: {
            id: result.run.id, meetingId: result.run.meetingId,
            shareId: result.run.shareId,
            shareGeneration: result.run.shareGeneration,
            targetLanguage: result.run.targetLanguage,
          } })
        : workerConflict(reply);
    });

  app.post("/internal/enterprise/meeting-screen-ocr/refresh",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const parsed = parseScreenOcrTicketBody(request.body);
      const ticket = parsed ? ticketPayload(parsed.ticket) : null;
      if (!ticket) return rejectedTicket(reply);
      if (!runtime.acceptMeetingScreenOcrWorker) return postgresRequired(reply);
      const now = new Date();
      const result = await runtime.acceptMeetingScreenOcrWorker({
        payload: ticket, traceId: enterpriseRequestTraceId(request), now,
      });
      if (result.status !== "accepted") return workerConflict(reply);
      const payload = { ...ticket, issuedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 300_000).toISOString() };
      return reply.send({ status: "accepted", expiresAt: payload.expiresAt,
        ticket: issueEnterpriseMeetingScreenOcrTicket({
          payload, signingSecret: screenOcrTicketSecret(),
        }) });
    });

  app.post("/internal/enterprise/meeting-screen-ocr/frames/claim",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const parsed = parseScreenOcrClaim(request.body);
      const ticket = parsed ? ticketPayload(parsed.ticket) : null;
      if (!parsed || !ticket) return invalid(reply);
      if (!runtime.claimMeetingScreenOcrFrame) return postgresRequired(reply);
      const result = await runtime.claimMeetingScreenOcrFrame({
        payload: ticket, traceId: enterpriseRequestTraceId(request),
        frameId: parsed.frameId, perceptualHash: parsed.perceptualHash,
        sourceWidth: parsed.sourceWidth, sourceHeight: parsed.sourceHeight,
        capturedAt: parsed.capturedAt, now: new Date(),
      });
      if (["claimed", "unchanged", "duplicate"].includes(result.status)) {
        return reply.send(result);
      }
      return workerConflict(reply);
    });

  app.post("/internal/enterprise/meeting-screen-ocr/frames/complete",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const parsed = parseScreenOcrComplete(request.body);
      const ticket = parsed ? ticketPayload(parsed.ticket) : null;
      if (!parsed || !ticket) return invalid(reply);
      if (!runtime.completeMeetingScreenOcrFrame) return postgresRequired(reply);
      const result = await runtime.completeMeetingScreenOcrFrame({
        payload: ticket, traceId: enterpriseRequestTraceId(request),
        frameId: parsed.frameId, providerFingerprint: parsed.providerFingerprint,
        blocks: parsed.blocks, now: new Date(),
      });
      if (result.status !== "completed") return workerConflict(reply);
      const published = await publishLayouts(
        ticket.communicationSessionId, ticket.meetingId, result,
      );
      return reply.send({ status: "completed",
        frameRevision: result.view.layout?.frame.frameRevision ?? 0,
        delivered: published ? result.targetIdentities.length : 0,
        delivery: published ? "data_channel" : "polling_fallback" });
    });

  app.post("/internal/enterprise/meeting-screen-ocr/frames/fail",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const parsed = parseScreenOcrFail(request.body);
      const ticket = parsed ? ticketPayload(parsed.ticket) : null;
      if (!parsed || !ticket) return invalid(reply);
      if (!runtime.failMeetingScreenOcrFrame) return postgresRequired(reply);
      const result = await runtime.failMeetingScreenOcrFrame({
        payload: ticket, traceId: enterpriseRequestTraceId(request),
        frameId: parsed.frameId, reasonCode: parsed.reasonCode,
        ...(parsed.providerFingerprint
          ? { providerFingerprint: parsed.providerFingerprint } : {}),
        now: new Date(),
      });
      return result.status === "failed" ? reply.send(result) : workerConflict(reply);
    });

  app.post("/internal/enterprise/meeting-screen-ocr/run/fail",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      const parsed = parseScreenOcrRunFail(request.body);
      const ticket = parsed ? ticketPayload(parsed.ticket) : null;
      if (!parsed || !ticket) return invalid(reply);
      if (!runtime.failMeetingScreenOcrFrame) return postgresRequired(reply);
      const result = await runtime.failMeetingScreenOcrFrame({
        payload: ticket, traceId: enterpriseRequestTraceId(request),
        reasonCode: parsed.reasonCode, now: new Date(),
      });
      return result.status === "failed" ? reply.send(result) : workerConflict(reply);
    });
}

async function publishLayouts(
  communicationSessionId: string,
  meetingId: string,
  result: Extract<Awaited<ReturnType<NonNullable<
    EnterpriseRepositoryRuntime["completeMeetingScreenOcrFrame"]>>>,
    { status: "completed" }>,
) {
  const layout = result.view.layout;
  const run = result.view.run;
  if (!layout || !run) return false;
  const config = getLiveKitRoomConfig();
  if (!config.ok) return false;
  const adapter = new LiveKitRoomProviderAdapter(config.config);
  const roomName = `ent_${communicationSessionId.replaceAll("-", "")}`;
  try {
    for (let index = 0; index < result.targetIdentities.length; index++) {
      const event: EnterpriseMeetingScreenOcrLayoutEvent = {
        v: 1, eventId: randomUUID(), type: "screen_ocr.layout", meetingId,
        targetParticipantId: result.targetParticipantIds[index]!,
        occurredAt: new Date().toISOString(),
        layout: screenOcrLayout(layout, run.shareGeneration),
      };
      const bytes = new TextEncoder().encode(JSON.stringify(event));
      if (bytes.byteLength > 12_000) return false;
      await adapter.publish(roomName, bytes, enterpriseMeetingScreenOcrTopic,
        [result.targetIdentities[index]!]);
    }
    return true;
  } catch { return false; }
}

function ticketPayload(ticket: string) {
  try {
    return verifyEnterpriseMeetingScreenOcrTicket({
      ticket, signingSecret: screenOcrTicketSecret(),
    });
  } catch { return null; }
}
function internalAuthorized(request: FastifyRequest) {
  const expected = Buffer.from(process.env.INTERNAL_API_SECRET?.trim() ?? "");
  const header = request.headers.authorization;
  const supplied = Buffer.from(header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length) : "");
  return expected.length >= 16 && expected.length === supplied.length &&
    timingSafeEqual(expected, supplied);
}
function unauthorized(reply: FastifyReply) {
  return sendError(reply, 401, "internal_error", "Unauthorized internal request");
}
function rejectedTicket(reply: FastifyReply) {
  return sendError(reply, 403, "screen_ocr_worker_ticket_rejected",
    "Screen OCR Worker ticket rejected");
}
function workerConflict(reply: FastifyReply) {
  return sendError(reply, 409, "screen_ocr_worker_conflict",
    "Screen OCR Worker runtime conflict");
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_screen_ocr_worker_request",
    "Invalid screen OCR Worker request");
}
function postgresRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
