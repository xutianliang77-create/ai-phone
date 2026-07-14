import {
  endSession,
  saveSessionDiagnostics,
  updateConsumedSeconds,
} from "./sessions.repository.js";
import type { RealtimeSessionDiagnosticsDto } from "@translation/contracts";
import { settleSessionUsage } from "./session-usage-settlement.js";
import { runStoreTransaction } from "../../infrastructure/storage/json-store.js";
import { enqueueOutboxEvent } from "../events/reliable-events.repository.js";
import { participantTrackSpeaker } from "@translation/contracts";
import { interruptActiveCallPlaybacks } from "../call-links/call-playbacks.repository.js";

export interface CompleteSessionWithUsageOptions {
  billableSeconds?: number;
  diagnostics?: RealtimeSessionDiagnosticsDto;
}

export function completeSessionWithUsage(
  sessionId: string,
  options: CompleteSessionWithUsageOptions = {},
) {
  return runStoreTransaction(() => completeSessionWithUsageTransaction(
    sessionId,
    options,
  ));
}

function completeSessionWithUsageTransaction(
  sessionId: string,
  options: CompleteSessionWithUsageOptions,
) {
  const result = endSession(sessionId);
  if (!result) return null;
  interruptActiveCallPlaybacks(
    sessionId,
    "session_end",
    result.session.endedAt ?? new Date().toISOString(),
  );
  enqueueCallLinkEndedEvent(result.session);
  if (options.diagnostics && !result.session.diagnostics) {
    saveSessionDiagnostics(sessionId, options.diagnostics);
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
  const updatedSession = updateConsumedSeconds(
    result.session.id,
    settlement.billableSeconds,
  );
  return updatedSession ?? result.session;
}

function enqueueCallLinkEndedEvent(
  session: NonNullable<ReturnType<typeof endSession>>["session"],
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
