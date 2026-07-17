import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { TokenVerifier } from "livekit-server-sdk";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { LiveKitEgressProviderAdapter } from "./livekit-egress-provider-adapter.js";
import { getLiveKitEgressConfig } from "./livekit-egress-readiness.js";
import {
  beginRecordingJob,
  createRecordingConsentSnapshot,
  findRecordingJob,
  latestParticipantRecordingConsents,
  listSessionRecordingJobs,
  recordParticipantRecordingConsent,
  updateRecordingJob,
} from "./recordings.repository.js";
import { listRecordingArtifacts } from "./recording-artifacts.repository.js";
import { registerRecordingStopRoutes } from "./recording-stop.routes.js";
import { applyRecordingProviderJob } from "./livekit-egress-reconciliation.js";
import {
  parseRecordingConsentRequest,
  parseStartRecordingRequest,
} from "./recording-request.js";

export function registerRecordingRoutes(app: FastifyInstance) {
  registerRecordingStopRoutes(app);
  app.post("/call-links/:callId/recording-consent", async (request, reply) => {
    const params = request.params as { callId: string };
    const body = parseRecordingConsentRequest(request.body);
    if (!body) {
      return sendError(reply, 400, "invalid_recording_consent", "Invalid consent request");
    }
    const call = await findCallLink(params.callId);
    if (!call || call.status === "ended") {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    const participantIdentity = await verifyParticipantToken(
      request.headers.authorization,
      call.roomName,
    );
    if (!participantIdentity) {
      return sendError(reply, 401, "invalid_call_room_token", "Invalid participant token");
    }
    const session = await findSession(call.sessionId);
    const leg = session?.callLegs?.find((item) =>
      item.participantIdentity === participantIdentity && item.status === "active"
    );
    if (!leg || !["host", "guest"].includes(leg.participantRole)) {
      return sendError(reply, 409, "recording_participant_not_active", "Participant is not active");
    }
    const consent = await withSessionWriteLock(call.sessionId, () =>
      recordParticipantRecordingConsent({
        sessionId: call.sessionId,
        participantIdentity,
        policyVersion: body.policyVersion,
        granted: body.consent,
      }));
    return reply.header("cache-control", "no-store").send({
      callId: call.callId,
      participantIdentity,
      policyVersion: consent.policyVersion,
      status: consent.status,
      createdAt: consent.createdAt,
    });
  });

  app.post("/call-links/:callId/recordings", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const params = request.params as { callId: string };
    const body = parseStartRecordingRequest(request.body);
    if (!body) {
      return sendError(reply, 400, "invalid_recording_request", "Invalid recording request");
    }
    const config = getLiveKitEgressConfig();
    if (!config.ok) {
      return sendError(reply, 503, "livekit_egress_not_configured", "Recording is unavailable");
    }
    if (body.retentionDays > config.config.maxRetentionDays) {
      return sendError(reply, 400, "recording_retention_too_long", "Retention exceeds policy");
    }
    const prepared = await withSessionWriteLock(params.callId, async () => {
      const call = await findCallLink(params.callId);
      if (!call) return failure(404, "call_link_not_found", "Call link not found");
      if (call.userId !== account.id) {
        return failure(403, "account_forbidden", "Account cannot access this resource");
      }
      if (call.status === "ended") {
        return failure(410, "call_link_expired", "Call link has ended");
      }
      const session = await findSession(call.sessionId);
      if (!session) {
        return failure(404, "session_not_found", "Session not found");
      }
      const humanLegs = (session.callLegs ?? []).filter((leg) =>
        leg.status === "active" && ["host", "guest"].includes(leg.participantRole)
      );
      if (humanLegs.length < 2) {
        return failure(409, "recording_participants_incomplete", "Two participants are required");
      }
      const targetLeg = body.participantIdentity
        ? humanLegs.find((leg) => leg.participantIdentity === body.participantIdentity)
        : undefined;
      if (body.participantIdentity && !targetLeg) {
        return failure(409, "recording_target_not_active", "Recording target is not active");
      }
      if (humanLegs.some((leg) => leg.joinType === "sip")) {
        return failure(
          409,
          "sip_recording_consent_required",
          "SIP recording requires provider-verified callee consent",
        );
      }
      const latest = latestParticipantRecordingConsents(call.sessionId);
      const consents = humanLegs.map((leg) => latest.get(leg.participantIdentity));
      if (consents.some((consent) =>
        !consent || consent.status !== "granted" ||
        consent.policyVersion !== body.policyVersion
      )) {
        return failure(409, "recording_consent_incomplete", "All participants must consent");
      }
      const snapshot = createRecordingConsentSnapshot({
        sessionId: call.sessionId,
        policyVersion: body.policyVersion,
        participantConsents: consents as NonNullable<(typeof consents)[number]>[],
      });
      const objectKey = `${config.config.objectPrefix}/${sessionKey(call.sessionId)}/${
        randomUUID()
      }.ogg`;
      const requestHash = hashJson({
        sessionId: call.sessionId,
        snapshotId: snapshot.id,
        retentionDays: body.retentionDays,
        recordingType: body.recordingType,
        participantIdentity: body.participantIdentity,
        trackId: body.trackId,
      });
      const begun = beginRecordingJob({
        sessionId: call.sessionId,
        roomName: call.roomName,
        recordingType: body.recordingType,
        participantIdentity: body.participantIdentity,
        trackId: body.trackId,
        consentSnapshotId: snapshot.id,
        retentionUntil: addDays(body.retentionDays),
        objectKey,
        idempotencyKey: body.idempotencyKey,
        requestHash,
      });
      return { ok: true as const, call, begun };
    });
    if (!prepared.ok) {
      return sendError(reply, prepared.status, prepared.code, prepared.message);
    }
    if (prepared.begun.status === "payload_conflict" ||
      prepared.begun.status === "active_conflict") {
      return sendError(reply, 409, "recording_operation_conflict", "Recording conflicts");
    }
    if (prepared.begun.status === "replayed") {
      return reply.status(202).send(recordingResponse(prepared.begun.job, true));
    }
    const job = prepared.begun.job;
    const operation = beginProviderOperation({
      sessionId: job.sessionId,
      provider: "livekit_egress",
      operationType: "egress_start",
      operationKey: job.id,
      idempotencyKey: `egress-start:${job.id}`,
      requestHash: job.requestHash,
    }).operation;
    updateRecordingJob({
      jobId: job.id,
      status: "starting",
      expectedVersion: job.version,
      providerOperationId: operation.id,
    });
    const provider = new LiveKitEgressProviderAdapter(config.config);
    const result = await provider.start({
      operationId: operation.id,
      sessionId: job.sessionId,
      expectedVersion: operation.version,
      idempotencyKey: operation.idempotencyKey,
      deadlineAt: deadline(config.config.requestTimeoutSeconds),
      payload: {
        roomName: job.roomName,
        recordingType: job.recordingType,
        objectKey: job.objectKey,
        participantIdentity: job.participantIdentity,
        trackId: job.trackId,
      },
    });
    if (!result.ok) {
      updateProviderOperation({
        operationId: operation.id,
        status: result.reconciliationRequired ? "unknown" : "failed",
        errorClass: result.errorClass,
      });
      if (!result.reconciliationRequired) {
        updateRecordingJob({
          jobId: job.id,
          status: "failed",
          errorClass: result.errorClass,
        });
      }
      return result.reconciliationRequired
        ? reply.status(202).send(recordingResponse(findRecordingJob(job.id)!, false))
        : sendError(reply, 503, "recording_start_failed", "Recording could not start");
    }
    updateProviderOperation({
      operationId: operation.id,
      status: "accepted",
      externalOperationId: result.result.recordingId,
      externalResourceId: result.result.recordingId,
    });
    updateRecordingJob({
      jobId: job.id,
      status: "starting",
      externalRecordingId: result.result.recordingId,
    });
    applyRecordingProviderJob(job.id, result.result);
    return reply.status(202).send(recordingResponse(findRecordingJob(job.id)!, false));
  });

  app.get("/call-links/:callId/recordings", async (request, reply) => {
    const account = requireAccount(request, reply);
    if (!account) return;
    const call = await findCallLink(
      (request.params as { callId: string }).callId,
    );
    if (!call) return sendError(reply, 404, "call_link_not_found", "Call link not found");
    if (call.userId !== account.id) {
      return sendError(reply, 403, "account_forbidden", "Account cannot access resource");
    }
    return {
      recordings: listSessionRecordingJobs(call.sessionId).map((job) =>
        recordingResponse(job, false)
      ),
    };
  });
}

function recordingResponse(job: NonNullable<ReturnType<typeof findRecordingJob>>, replayed: boolean) {
  return {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status,
    recordingType: job.recordingType,
    participantIdentity: job.participantIdentity,
    trackId: job.trackId,
    contentType: job.contentType,
    retentionUntil: job.retentionUntil,
    replayed,
    artifacts: listRecordingArtifacts(job.id).map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      contentType: artifact.contentType,
      sizeBytes: artifact.sizeBytes,
      durationMs: artifact.durationMs,
      sha256: artifact.sha256,
      manifestSha256: artifact.manifestSha256,
      verifiedAt: artifact.verifiedAt,
      deletedAt: artifact.deletedAt,
      lastErrorClass: artifact.lastErrorClass,
    })),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}

async function verifyParticipantToken(authorization: string | undefined, roomName: string) {
  const config = getLiveKitRoomConfig();
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!config.ok || !token) return null;
  try {
    const claims = await new TokenVerifier(
      config.config.apiKey,
      config.config.apiSecret,
    ).verify(token);
    return claims.video?.roomJoin === true && claims.video.room === roomName &&
        typeof claims.sub === "string"
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

function failure(status: 403 | 404 | 409 | 410, code: string, message: string) {
  return { ok: false as const, status, code, message };
}

function sessionKey(sessionId: string) {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 32);
}

function hashJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function addDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function deadline(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
