import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { TokenVerifier } from "livekit-server-sdk";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations-runtime.repository.js";
import { findSession } from "../sessions/sessions-runtime.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { findCallLink } from "../call-links/call-links.service.js";
import { getLiveKitRoomConfig } from "../call-links/call-room-readiness.js";
import { findAgentCallDraftByCallReference } from
  "../agent-calls/agent-calls-runtime.repository.js";
import { findWorkerDispatch } from
  "../worker-dispatches/worker-dispatch-runtime.repository.js";
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
} from "./recordings-runtime.repository.js";
import { registerRecordingStopRoutes } from "./recording-stop.routes.js";
import { applyRecordingProviderJob } from "./livekit-egress-reconciliation.js";
import { evaluateRecordingConsentGate } from "./recording-consent-gate.js";
import {
  parseRecordingConsentRequest,
  parseStartRecordingRequest,
} from "./recording-request.js";
import { recordingResponse } from "./recording-response.js";

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
    if (leg.joinType === "sip") {
      return sendError(
        reply,
        409,
        "recording_runtime_consent_required",
        "SIP consent must be reported by the bound runtime",
      );
    }
    const consent = await withSessionWriteLock(call.sessionId, () =>
      recordParticipantRecordingConsent({
        sessionId: call.sessionId,
        participantIdentity,
        policyVersion: body.policyVersion,
        granted: body.consent,
        source: "participant_token",
        participantRole: leg.participantRole as "host" | "guest",
        joinType: leg.joinType as "app" | "web",
        observedAt: new Date().toISOString(),
        expiresAt: call.expiresAt,
      }));
    return reply.header("cache-control", "no-store").send({
      callId: call.callId,
      participantIdentity,
      policyVersion: consent.policyVersion,
      status: consent.status,
      createdAt: consent.createdAt,
    });
  });

  app.get("/call-links/:callId/recording-consents", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const call = await findCallLink(
      (request.params as { callId: string }).callId,
    );
    if (!call) {
      return sendError(reply, 404, "call_link_not_found", "Call link not found");
    }
    if (call.userId !== account.id) {
      return sendError(reply, 403, "account_forbidden", "Account cannot access resource");
    }
    const latest = await latestParticipantRecordingConsents(call.sessionId);
    return reply.header("cache-control", "no-store").send({
      callId: call.callId,
      consents: [...latest.values()].map((consent) => ({
        id: consent.id,
        participantIdentity: consent.participantIdentity,
        policyVersion: consent.policyVersion,
        status: consent.status,
        source: consent.source,
        participantRole: consent.participantRole,
        joinType: consent.joinType,
        generation: consent.generation,
        runtimeEventId: consent.runtimeEventId,
        evidenceHash: consent.evidenceHash,
        observedAt: consent.observedAt,
        expiresAt: consent.expiresAt,
        createdAt: consent.createdAt,
      })),
    });
  });

  app.post("/call-links/:callId/recordings", async (request, reply) => {
    const account = await requireAccount(request, reply);
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
      const latest = await latestParticipantRecordingConsents(call.sessionId);
      const [agentDraft, dispatch] = call.purpose === "voice_agent"
        ? await Promise.all([
            findAgentCallDraftByCallReference({ callId: call.callId }),
            findWorkerDispatch(call.sessionId),
          ])
        : [null, null];
      const gate = evaluateRecordingConsentGate({
        purpose: call.purpose,
        policyVersion: body.policyVersion,
        callLegs: session.callLegs ?? [],
        latestConsents: latest,
        agentDraft,
        dispatchGeneration: dispatch?.generation,
      });
      if (!gate.ok) return failure(409, gate.code, gate.message);
      const targetLeg = body.participantIdentity
        ? gate.participantLegs.find((leg) =>
            leg.participantIdentity === body.participantIdentity)
        : undefined;
      if (body.participantIdentity && !targetLeg) {
        return failure(409, "recording_target_not_active", "Recording target is not active");
      }
      const snapshot = await createRecordingConsentSnapshot({
        sessionId: call.sessionId,
        policyVersion: body.policyVersion,
        participantConsents: gate.consents,
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
      const begun = await beginRecordingJob({
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
      return reply.status(202).send(
        await recordingResponse(prepared.begun.job, true),
      );
    }
    const job = prepared.begun.job;
    const operation = (await beginProviderOperation({
      sessionId: job.sessionId,
      provider: "livekit_egress",
      operationType: "egress_start",
      operationKey: job.id,
      idempotencyKey: `egress-start:${job.id}`,
      requestHash: job.requestHash,
    })).operation;
    await updateRecordingJob({
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
      await updateProviderOperation({
        operationId: operation.id,
        status: result.reconciliationRequired ? "unknown" : "failed",
        errorClass: result.errorClass,
      });
      if (!result.reconciliationRequired) {
        await updateRecordingJob({
          jobId: job.id,
          status: "failed",
          errorClass: result.errorClass,
        });
      }
      return result.reconciliationRequired
        ? reply.status(202).send(
          await recordingResponse((await findRecordingJob(job.id))!, false),
        )
        : sendError(reply, 503, "recording_start_failed", "Recording could not start");
    }
    await updateProviderOperation({
      operationId: operation.id,
      status: "accepted",
      externalOperationId: result.result.recordingId,
      externalResourceId: result.result.recordingId,
    });
    await updateRecordingJob({
      jobId: job.id,
      status: "starting",
      externalRecordingId: result.result.recordingId,
    });
    await applyRecordingProviderJob(job.id, result.result);
    return reply.status(202).send(
      await recordingResponse((await findRecordingJob(job.id))!, false),
    );
  });

  app.get("/call-links/:callId/recordings", async (request, reply) => {
    const account = await requireAccount(request, reply);
    if (!account) return;
    const call = await findCallLink(
      (request.params as { callId: string }).callId,
    );
    if (!call) return sendError(reply, 404, "call_link_not_found", "Call link not found");
    if (call.userId !== account.id) {
      return sendError(reply, 403, "account_forbidden", "Account cannot access resource");
    }
    const jobs = await listSessionRecordingJobs(call.sessionId);
    return { recordings: await Promise.all(jobs.map((job) =>
      recordingResponse(job, false)
    )) };
  });
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
