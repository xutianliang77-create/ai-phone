import {
  claimPendingOutboxEvents,
  markOutboxFailed,
  markOutboxPublished,
  processInboxEventAsync,
  releaseOutboxClaim,
  hasInboxEvent,
  pendingOutboxSessionIds,
  type ClaimedOutboxEvent,
} from "../events/reliable-events-runtime.repository.js";
import {
  assertSessionVersion,
  findSession,
} from "../sessions/sessions-runtime.repository.js";
import { persistCallRoomDataEvent } from "./call-room-event-persistence.js";
import type { CallLinkRecord } from "./call-links.service.js";
import type { CallRoomDataEvent } from "./call-room-events.js";

const callRoomOutboxEventType = "call_room.data";

export async function stageCallRoomDataEvents(options: {
  record: CallLinkRecord;
  events: CallRoomDataEvent[];
  expectedVersion?: number;
}) {
  const duplicateOnly = (await Promise.all(options.events.map((event) =>
    hasInboxEvent(eventId(options.record, event))
  ))).every(Boolean);
  if (!duplicateOnly) {
    await assertSessionVersion(options.record.sessionId, options.expectedVersion);
  }
  let duplicateCount = 0;
  for (const submitted of options.events) {
    const id = eventId(options.record, submitted);
    const event = { ...submitted, eventId: id };
    const staged = await processInboxEventAsync({
        eventId: id,
        sessionId: options.record.sessionId,
        eventType: event.type,
        payload: event,
        process: () => persistCallRoomDataEvent(options.record, event),
        outbox: {
          idempotencyKey: `outbox:${id}`,
          sessionId: options.record.sessionId,
          eventType: callRoomOutboxEventType,
          payload: event,
        },
    });
    if (staged.duplicate) duplicateCount += 1;
  }
  return {
    duplicateCount,
    sessionVersion: (await findSession(options.record.sessionId))?.version ?? 1,
  };
}

export async function pendingCallRoomDataEvents(sessionId: string, now?: Date) {
  return (await claimPendingOutboxEvents({
    sessionId,
    eventType: callRoomOutboxEventType,
    now,
  })).map((record) => ({
    record,
    event: record.payload as CallRoomDataEvent,
  }));
}

export function pendingCallRoomSessionIds(now?: Date) {
  return pendingOutboxSessionIds(callRoomOutboxEventType, now);
}

export function completeCallRoomDataEvent(event: ClaimedOutboxEvent) {
  return markOutboxPublished(event);
}

export function failCallRoomDataEvent(
  event: ClaimedOutboxEvent,
  error: unknown,
) {
  return markOutboxFailed(event, error);
}

export function releaseCallRoomDataEvent(event: ClaimedOutboxEvent) {
  return releaseOutboxClaim(event);
}

function eventId(record: CallLinkRecord, event: CallRoomDataEvent) {
  return [
    "call-room",
    record.callId,
    event.type,
    event.playbackId ?? event.segmentId,
    ...(event.generation ? [event.generation] : []),
    ...(event.pipelineGeneration
      ? [`pipeline-${event.pipelineGeneration}`]
      : event.revision !== undefined
        ? [`revision-${event.revision}`]
        : []),
  ].join(":");
}
