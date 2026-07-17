import type { FastifyInstance } from "fastify";
import { sendError } from "../../infrastructure/http/errors.js";
import { requireAccount } from "../account/account-auth.js";
import { findCallLink } from "../call-links/call-links.service.js";
import {
  beginProviderOperation,
  updateProviderOperation,
} from "../provider-operations/provider-operations.repository.js";
import { withSessionWriteLock } from "../sessions/session-write-coordinator.js";
import { LiveKitEgressProviderAdapter } from "./livekit-egress-provider-adapter.js";
import { getLiveKitEgressConfig } from "./livekit-egress-readiness.js";
import {
  findRecordingJob,
  updateRecordingJob,
} from "./recordings.repository.js";
import { applyRecordingProviderJob } from "./livekit-egress-reconciliation.js";

export function registerRecordingStopRoutes(app: FastifyInstance) {
  app.post(
    "/call-links/:callId/recordings/:recordingId/stop",
    async (request, reply) => {
      const account = requireAccount(request, reply);
      if (!account) return;
      const params = request.params as { callId: string; recordingId: string };
      const config = getLiveKitEgressConfig();
      if (!config.ok) {
        return sendError(reply, 503, "livekit_egress_not_configured", "Recording is unavailable");
      }
      const prepared = await withSessionWriteLock(params.callId, async () => {
        const call = await findCallLink(params.callId);
        if (!call) return failure(404, "call_link_not_found", "Call link not found");
        if (call.userId !== account.id) {
          return failure(403, "account_forbidden", "Account cannot access resource");
        }
        const job = findRecordingJob(params.recordingId);
        if (!job || job.sessionId !== call.sessionId) {
          return failure(404, "recording_not_found", "Recording not found");
        }
        if (["completed", "failed"].includes(job.status)) {
          return { ok: true as const, job, terminal: true as const };
        }
        if (!job.externalRecordingId) {
          return failure(409, "recording_not_started", "Recording has not started");
        }
        if (job.status !== "stopping") {
          updateRecordingJob({
            jobId: job.id,
            status: "stopping",
            expectedVersion: job.version,
          });
        }
        return { ok: true as const, job, terminal: false as const };
      });
      if (!prepared.ok) {
        return sendError(reply, prepared.status, prepared.code, prepared.message);
      }
      if (prepared.terminal) return reply.status(202).send(response(prepared.job));
      const job = findRecordingJob(prepared.job.id)!;
      const operation = beginProviderOperation({
        sessionId: job.sessionId,
        provider: "livekit_egress",
        operationType: "egress_stop",
        operationKey: job.id,
        idempotencyKey: `egress-stop:${job.id}`,
        requestHash: job.externalRecordingId!,
      }).operation;
      const result = await new LiveKitEgressProviderAdapter(config.config).stop({
        operationId: operation.id,
        sessionId: job.sessionId,
        expectedVersion: operation.version,
        idempotencyKey: operation.idempotencyKey,
        deadlineAt: new Date(
          Date.now() + config.config.requestTimeoutSeconds * 1000,
        ).toISOString(),
        payload: { recordingId: job.externalRecordingId! },
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
          ? reply.status(202).send(response(findRecordingJob(job.id)!))
          : sendError(reply, 503, "recording_stop_failed", "Recording could not stop");
      }
      updateProviderOperation({
        operationId: operation.id,
        status: "accepted",
        externalOperationId: result.result.recordingId,
        externalResourceId: result.result.recordingId,
      });
      applyRecordingProviderJob(job.id, result.result);
      return reply.status(202).send(response(findRecordingJob(job.id)!));
    },
  );
}

function response(job: NonNullable<ReturnType<typeof findRecordingJob>>) {
  return {
    id: job.id,
    sessionId: job.sessionId,
    status: job.status,
    recordingType: job.recordingType,
    retentionUntil: job.retentionUntil,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
  };
}

function failure(status: 403 | 404 | 409, code: string, message: string) {
  return { ok: false as const, status, code, message };
}
