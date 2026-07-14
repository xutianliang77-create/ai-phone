import {
  listPendingOutboxEvents,
  markOutboxFailed,
  markOutboxPublished,
  processInboxEvent,
} from "../events/reliable-events.repository.js";
import {
  assertSessionVersion,
  findSession,
} from "../sessions/sessions.repository.js";
import {
  getStoreSnapshot,
  runStoreTransaction,
} from "../../infrastructure/storage/json-store.js";
import { persistCallRoomDataEvent } from "./call-room-event-persistence.js";
import type { CallLinkRecord } from "./call-links.service.js";
import type { CallRoomDataEvent } from "./call-room-events.js";

const callRoomOutboxEventType = "call_room.data";

export function stageCallRoomDataEvents(options: {
  record: CallLinkRecord;
  events: CallRoomDataEvent[];
  expectedVersion?: number;
}) {
  return runStoreTransaction(() => {
    const duplicateOnly = options.events.every((event) =>
      hasInboxEvent(eventId(options.record, event))
    );
    if (!duplicateOnly) {
      assertSessionVersion(options.record.sessionId, options.expectedVersion);
    }
    let duplicateCount = 0;
    for (const submitted of options.events) {
      const id = eventId(options.record, submitted);
      const event = { ...submitted, eventId: id };
      const staged = processInboxEvent({
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
      sessionVersion: findSession(options.record.sessionId)?.version ?? 1,
    };
  });
}

export function pendingCallRoomDataEvents(sessionId: string, now?: Date) {
  return listPendingOutboxEvents({
    sessionId,
    eventType: callRoomOutboxEventType,
    now,
  }).map((record) => ({
    record,
    event: record.payload as CallRoomDataEvent,
  }));
}

export function pendingCallRoomSessionIds(now?: Date) {
  return [...new Set(listPendingOutboxEvents({
    eventType: callRoomOutboxEventType,
    now,
  }).map((event) => event.sessionId))];
}

export function completeCallRoomDataEvent(idempotencyKey: string) {
  return markOutboxPublished(idempotencyKey);
}

export function failCallRoomDataEvent(idempotencyKey: string, error: unknown) {
  return markOutboxFailed(idempotencyKey, error);
}

function eventId(record: CallLinkRecord, event: CallRoomDataEvent) {
  return [
    "call-room",
    record.callId,
    event.type,
    event.playbackId ?? event.segmentId,
    ...(event.generation ? [event.generation] : []),
  ].join(":");
}

function hasInboxEvent(eventId: string) {
  return getStoreSnapshot().inboxEvents.some((event) => event.eventId === eventId);
}
