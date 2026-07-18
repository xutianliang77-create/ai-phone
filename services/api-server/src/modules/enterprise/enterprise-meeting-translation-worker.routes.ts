import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { enterpriseMeetingTranslationTopic } from "@translation/contracts";
import { sendError } from "../../infrastructure/http/errors.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitRoomProviderAdapter } from
  "../call-links/livekit-room-provider-adapter.js";
import { enterpriseRequestTraceId } from "./enterprise-auth.js";
import type { EnterpriseMeetingRepositoryRuntime } from
  "./enterprise-meeting-runtime.js";
import type { EnterpriseMeetingWorkerCaptionInput } from
  "./enterprise-meeting-translation.js";

export function registerEnterpriseMeetingTranslationWorkerRoutes(
  app: FastifyInstance,
  runtime: EnterpriseMeetingRepositoryRuntime,
) {
  app.post("/internal/enterprise/meeting-translation/snapshot",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.acceptMeetingTranslationWorker) return storageRequired(reply);
      const body = workerRequest(request.body);
      if (!body) return invalid(reply);
      const result = await runtime.acceptMeetingTranslationWorker({
        ...body, traceId: enterpriseRequestTraceId(request),
        leaseSeconds: leaseSeconds(),
      });
      return workerResult(reply, result);
    });

  app.post("/internal/enterprise/meeting-translation/heartbeat",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.heartbeatMeetingTranslationWorker) return storageRequired(reply);
      const body = workerRequest(request.body);
      if (!body) return invalid(reply);
      const result = await runtime.heartbeatMeetingTranslationWorker({
        ...body, traceId: enterpriseRequestTraceId(request),
        leaseSeconds: leaseSeconds(),
      });
      return workerResult(reply, result);
    });

  app.post("/internal/enterprise/meeting-translation/refresh",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.refreshMeetingTranslationWorker) return storageRequired(reply);
      const body = workerRequest(request.body);
      if (!body) return invalid(reply);
      const result = await runtime.refreshMeetingTranslationWorker({
        ...body, traceId: enterpriseRequestTraceId(request),
        leaseSeconds: leaseSeconds(), ticketTtlSeconds: ticketTtlSeconds(),
      });
      return workerResult(reply, result);
    });

  app.post("/internal/enterprise/meeting-translation/events",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.publishMeetingTranslationEvents) return storageRequired(reply);
      const body = eventRequest(request.body);
      if (!body) return invalid(reply);
      const result = await runtime.publishMeetingTranslationEvents({
        ...body, traceId: enterpriseRequestTraceId(request),
      });
      if (!("deliveries" in result) || result.status !== "authorized") {
        return workerResult(reply, result);
      }
      const published = await publishDeliveries(result.deliveries);
      if (!published.ok) {
        return sendError(reply, 503, published.reasonCode,
          "Meeting translation delivery is not ready");
      }
      return reply.send({ status: "published", delivered: result.deliveries.length });
    });

  app.post("/internal/enterprise/meeting-translation/finalize",
    async (request, reply) => {
      if (!internalAuthorized(request)) return unauthorized(reply);
      if (!runtime.finalizeMeetingTranslationWorker) return storageRequired(reply);
      const body = finalizeRequest(request.body);
      if (!body) return invalid(reply);
      const result = await runtime.finalizeMeetingTranslationWorker({
        ...body, traceId: enterpriseRequestTraceId(request),
      });
      return workerResult(reply, result);
    });
}

function workerRequest(value: unknown) {
  const body = record(value);
  if (!body || !exactKeys(body, ["ticket", "workerCellId", "workerId"]) ||
    !bounded(body.ticket, 4_096, 64) || !code(body.workerCellId) ||
    !code(body.workerId)) return null;
  return {
    ticket: body.ticket,
    workerCellId: body.workerCellId,
    workerId: body.workerId,
  };
}

function eventRequest(value: unknown) {
  const body = record(value);
  if (!body || !exactKeys(body, [
    "ticket", "workerCellId", "workerId", "sourceParticipantId",
    "sourceTrackSid", "events",
  ]) || !bounded(body.ticket, 4_096, 64) || !code(body.workerCellId) ||
    !code(body.workerId) || !uuid(body.sourceParticipantId) ||
    !bounded(body.sourceTrackSid, 128) || !Array.isArray(body.events) ||
    body.events.length < 1 || body.events.length > 16) return null;
  const events = body.events.map(captionEvent);
  if (events.some((event) => !event)) return null;
  return {
    ticket: body.ticket, workerCellId: body.workerCellId,
    workerId: body.workerId, sourceParticipantId: body.sourceParticipantId,
    sourceTrackSid: body.sourceTrackSid,
    events: events as EnterpriseMeetingWorkerCaptionInput[],
  };
}

function captionEvent(value: unknown): EnterpriseMeetingWorkerCaptionInput | null {
  const event = record(value);
  if (!event || !exactKeys(event, [
    "type", "segmentId", "revision", "sourceLanguage", "targetLanguage",
    "sourceText", "text", "timestampMs",
  ]) || !["transcript.final", "translation.final"].includes(String(event.type)) ||
    !bounded(event.segmentId, 160) || !integer(event.revision, 0) ||
    !language(event.sourceLanguage) || !language(event.targetLanguage) ||
    event.sourceLanguage === event.targetLanguage ||
    !bounded(event.sourceText, 4_000) || !bounded(event.text, 4_000) ||
    !integer(event.timestampMs, 1)) return null;
  return event as unknown as EnterpriseMeetingWorkerCaptionInput;
}

function finalizeRequest(value: unknown) {
  const body = record(value);
  if (!body || !exactKeys(body, [
    "ticket", "workerCellId", "workerId", "outcome",
  ]) || !bounded(body.ticket, 4_096, 64) || !code(body.workerCellId) ||
    !code(body.workerId) || !["completed", "failed"].includes(String(body.outcome))) {
    return null;
  }
  return { ticket: body.ticket, workerCellId: body.workerCellId,
    workerId: body.workerId, outcome: body.outcome as "completed" | "failed" };
}

async function publishDeliveries(deliveries: Array<{
  event: unknown; destinationIdentity: string;
}>): Promise<{ ok: true } | { ok: false; reasonCode: string }> {
  if (deliveries.length === 0) return { ok: true };
  const config = getLiveKitRoomConfig();
  if (!config.ok) return { ok: false, reasonCode: "meeting_rtc_not_configured" };
  const adapter = new LiveKitRoomProviderAdapter(config.config);
  try {
    for (const delivery of deliveries) {
      const event = record(delivery.event);
      const sessionId = typeof event?.communicationSessionId === "string"
        ? event.communicationSessionId : "";
      const payload = new TextEncoder().encode(JSON.stringify(delivery.event));
      if (!uuid(sessionId) || payload.byteLength > 12_000) {
        return { ok: false, reasonCode: "translation_packet_invalid" };
      }
      await adapter.publish(
        `ent_${sessionId.replaceAll("-", "")}`,
        payload,
        enterpriseMeetingTranslationTopic,
        [delivery.destinationIdentity],
      );
    }
    return { ok: true };
  } catch {
    return { ok: false, reasonCode: "translation_delivery_unavailable" };
  }
}

function workerResult(reply: FastifyReply, result: { status: string }) {
  if (["accepted", "authorized", "completed", "failed"].includes(result.status)) {
    return reply.send(result);
  }
  if (["invalid_ticket", "ticket_expired"].includes(result.status)) {
    return sendError(reply, 403, "worker_ticket_rejected", "Worker ticket rejected");
  }
  return sendError(reply, 409, "worker_runtime_conflict", "Worker runtime conflict");
}

function internalAuthorized(request: FastifyRequest) {
  const expected = process.env.INTERNAL_API_SECRET?.trim() ?? "";
  const authorization = request.headers.authorization;
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "";
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length >= 16 && left.length === right.length &&
    timingSafeEqual(left, right);
}
function unauthorized(reply: FastifyReply) {
  return sendError(reply, 401, "internal_error", "Unauthorized internal request");
}
function storageRequired(reply: FastifyReply) {
  return sendError(reply, 503, "enterprise_postgres_required",
    "Enterprise PostgreSQL runtime required");
}
function invalid(reply: FastifyReply) {
  return sendError(reply, 400, "invalid_meeting_translation_worker_request",
    "Invalid meeting translation Worker request");
}
function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key));
}
function bounded(value: unknown, maximum: number, minimum = 1): value is string {
  return typeof value === "string" && Buffer.byteLength(value) >= minimum &&
    Buffer.byteLength(value) <= maximum;
}
function code(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}
function language(value: unknown): value is "zh" | "en" {
  return value === "zh" || value === "en";
}
function integer(value: unknown, minimum: number) {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
function leaseSeconds() {
  return envInteger("ENTERPRISE_MEETING_WORKER_LEASE_SECONDS", 45, 15, 300);
}
function ticketTtlSeconds() {
  return envInteger("ENTERPRISE_MEETING_WORKER_TICKET_TTL_SECONDS", 300, 30, 300);
}
function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed : fallback;
}
