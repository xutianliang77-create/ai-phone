import {
  endSession as endLegacySession,
  saveSessionDiagnostics as saveLegacySessionDiagnostics,
  updateConsumedSeconds as updateLegacyConsumedSeconds,
  findSession as findLegacySession,
} from "./sessions.repository.js";
import {
  participantTrackSpeaker,
  transitionRealtimeSessionState,
  type RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";
import {
  estimateSessionDurationSeconds,
  normalizeMeasuredBillableSeconds,
  settleSessionUsage,
  toBillableSeconds,
} from "./session-usage-settlement.js";
import { runStoreTransaction } from "../../infrastructure/storage/json-store.js";
import { enqueueOutboxEvent } from "../events/reliable-events.repository.js";
import { interruptActiveCallPlaybacks } from "../call-links/call-playbacks.repository.js";
import { activePlanForUser } from "../plans/plans-runtime.service.js";
import { withPostgresRepositoryFence } from
  "../../infrastructure/storage/postgres-repository-fence.js";
import {
  repositoryCommandId,
  repositoryRequestHash,
} from "../../infrastructure/storage/repository-command-identity.js";
import { getRepositoryRuntime } from
  "../../infrastructure/storage/repository-runtime.js";
import type { SessionRecord } from "./session-record.js";

export interface CompleteSessionWithUsageOptions {
  billableSeconds?: number;
  diagnostics?: RealtimeSessionDiagnosticsDto;
  endedAt?: Date;
}

export async function completeSessionWithUsage(
  sessionId: string,
  options: CompleteSessionWithUsageOptions = {},
) {
  const runtime = getRepositoryRuntime();
  if (runtime.driver === "postgres") {
    return completePostgresSessionWithUsage(sessionId, options);
  }
  if(findLegacySession(sessionId)?.processingAuthorization) throw new Error("Public sessions require verified runtime finalization");
  return runStoreTransaction(() => completeSessionWithUsageTransaction(
    sessionId,
    options,
  ));
}

export function completeSessionWithUsageTransaction(
  sessionId: string,
  options: CompleteSessionWithUsageOptions,
) {
  const result = endLegacySession(sessionId,options.endedAt);
  if (!result) return null;
  interruptActiveCallPlaybacks(
    sessionId,
    "session_end",
    result.session.endedAt ?? new Date().toISOString(),
  );
  enqueueCallLinkEndedEvent(result.session);
  if (options.diagnostics && !result.session.diagnostics) {
    saveLegacySessionDiagnostics(sessionId, options.diagnostics);
  }

  if (result.wasAlreadyEnded && typeof options.billableSeconds !== "number") {
    return result.session;
  }

  const settlement = settleSessionUsage(
    result.session,
    typeof options.billableSeconds === "number"
      ? { billableSeconds: options.billableSeconds }
      : {},
  );
  const updatedSession = updateLegacyConsumedSeconds(
    result.session.id,
    settlement.billableSeconds,
  );
  return updatedSession ?? result.session;
}

function completePostgresSessionWithUsage(
  sessionId: string,
  options: CompleteSessionWithUsageOptions,
) {
  return withPostgresRepositoryFence(
    { aggregateType: "communication_session", aggregateId: sessionId },
    async (fence) => {
      const runtime = getRepositoryRuntime();
      if (runtime.driver !== "postgres") {
        throw new Error("PostgreSQL session completion runtime changed");
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = await runtime.postgres.sessions.find(sessionId);
        if (!current) return null;
        if(current.processingAuthorization) throw new Error("Public sessions require verified runtime finalization");
        if (current.status === "ended") return current;
        const transition = transitionRealtimeSessionState(current.status, "ended");
        if (!transition.accepted) return null;
        const endedAt = new Date().toISOString();
        const rawSeconds = estimateSessionDurationSeconds(
          current.createdAt,
          endedAt,
        );
        const billableSeconds = options.billableSeconds === undefined
          ? toBillableSeconds(rawSeconds)
          : normalizeMeasuredBillableSeconds(options.billableSeconds);
        const next = completedSession(current, endedAt, billableSeconds, options);
        const requestHash = repositoryRequestHash({
          sessionId,
          expectedVersion: current.version,
          billableSeconds,
          diagnostics: options.diagnostics,
        });
        const commandId = repositoryCommandId({
          aggregateId: sessionId,
          operation: "complete-with-usage",
          version: current.version ?? 1,
          requestHash,
        });
        const result = await runtime.postgres.sessionCompletion.complete({
          sessionId,
          userId: current.userId,
          nextSession: next,
          expectedVersion: current.version,
          billableSeconds,
          plan: await activePlanForUser(current.userId),
          idempotencyKey: `settle:${sessionId}`,
          commandId,
          requestHash,
          note: current.mode === "call_link"
            ? "call_link_usage" : "realtime_session_usage",
          fence,
        });
        if (result.status === "completed" || result.status === "already_ended") {
          return result.session;
        }
        if (result.status === "not_found") return null;
        if (result.status === "idempotency_conflict") {
          throw new Error("Session completion ledger conflicts with active session");
        }
      }
      throw new Error(`Session completion version conflict: ${sessionId}`);
    },
  );
}

function completedSession(
  current: SessionRecord,
  endedAt: string,
  billableSeconds: number,
  options: CompleteSessionWithUsageOptions,
) {
  const next = structuredClone(current);
  next.version = (current.version ?? 1) + 1;
  next.status = "ended";
  next.endedAt = endedAt;
  next.lastActivityAt = endedAt;
  next.consumedSeconds = billableSeconds;
  if (options.diagnostics && !next.diagnostics) {
    next.diagnostics = options.diagnostics;
  }
  next.playbacks = next.playbacks?.map((playback) =>
    ["queued", "streaming", "interrupting"].includes(playback.status)
      ? {
        ...playback,
        status: "interrupted",
        interruptReason: "session_end",
        endedAt,
      }
      : playback
  );
  return next;
}

function enqueueCallLinkEndedEvent(
  session: SessionRecord,
) {
  if (session.mode !== "call_link" || !session.callLink) return;
  const timestampMs = Date.parse(session.endedAt ?? new Date().toISOString());
  enqueueOutboxEvent({
    idempotencyKey: `outbox:call-room:${session.id}:session-ended`,
    sessionId: session.id,
    eventType: "call_room.data",
    payload: {
      eventId: `call-room:${session.id}:worker.status:session-ended`,
      type: "worker.status",
      callId: session.id,
      roomName: session.callLink.roomName,
      segmentId: "session-ended",
      speakerRole: "worker",
      speaker: participantTrackSpeaker("worker"),
      sourceLanguage: "zh",
      targetLanguage: "en",
      text: "通话已结束",
      stage: "worker",
      retryable: false,
      timestampMs,
    },
  });
}
