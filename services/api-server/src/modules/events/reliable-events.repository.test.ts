import { beforeEach, describe, expect, it } from "vitest";
import { getStoreSnapshot } from "../../infrastructure/storage/json-store.js";
import {
  InboxPayloadConflictError,
  processInboxEvent,
} from "./reliable-events.repository.js";

describe("reliable events repository", () => {
  beforeEach(() => {
    const store = getStoreSnapshot();
    store.inboxEvents = [];
    store.outboxEvents = [];
  });

  it("commits the domain mutation, inbox, and outbox together", () => {
    const domain: string[] = [];

    const result = processInboxEvent({
      eventId: "event-1",
      sessionId: "session-1",
      eventType: "translation.final",
      payload: { text: "hello" },
      process: () => domain.push("processed"),
      outbox: outbox("event-1"),
    });

    expect(result.duplicate).toBe(false);
    expect(domain).toEqual(["processed"]);
    expect(getStoreSnapshot()).toMatchObject({
      inboxEvents: [{ eventId: "event-1", sessionId: "session-1" }],
      outboxEvents: [{
        idempotencyKey: "outbox:event-1",
        sessionId: "session-1",
        attempts: 0,
      }],
    });
  });

  it("returns duplicate without repeating the domain mutation or outbox", () => {
    let processed = 0;
    const operation = () => processInboxEvent({
      eventId: "event-1",
      sessionId: "session-1",
      eventType: "translation.final",
      payload: { text: "hello" },
      process: () => { processed += 1; },
      outbox: outbox("event-1"),
    });

    operation();
    const duplicate = operation();

    expect(duplicate.duplicate).toBe(true);
    expect(processed).toBe(1);
    expect(getStoreSnapshot().inboxEvents).toHaveLength(1);
    expect(getStoreSnapshot().outboxEvents).toHaveLength(1);
  });

  it("rejects reuse of an event id with a different payload", () => {
    processInboxEvent({
      eventId: "event-1",
      sessionId: "session-1",
      eventType: "translation.final",
      payload: { text: "hello" },
      process: () => undefined,
      outbox: outbox("event-1"),
    });

    expect(() => processInboxEvent({
      eventId: "event-1",
      sessionId: "session-1",
      eventType: "translation.final",
      payload: { text: "changed" },
      process: () => undefined,
      outbox: outbox("event-1"),
    })).toThrow(InboxPayloadConflictError);
    expect(getStoreSnapshot().inboxEvents).toHaveLength(1);
  });
});

function outbox(eventId: string) {
  return {
    idempotencyKey: `outbox:${eventId}`,
    sessionId: "session-1",
    eventType: "call_room.data",
    payload: { eventId },
  };
}
