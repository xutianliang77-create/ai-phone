import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  PostgresInboxPayloadConflictError,
  PostgresReliableInboxRepository,
} from "./postgres-reliable-inbox.repository.js";

describe("PostgresReliableInboxRepository", () => {
  it("reserves before processing and persists the result envelope", async () => {
    const callReliableInbox = vi.fn()
      .mockResolvedValueOnce([{ event_id: "event-1", inserted: true }])
      .mockResolvedValueOnce([{ event_id: "event-1" }]);
    const process = vi.fn().mockResolvedValue({ status: "updated" });

    const result = await new PostgresReliableInboxRepository().process(
      { callReliableInbox } as never,
      eventInput(),
      process,
    );

    expect(result).toEqual({ duplicate: false, result: { status: "updated" } });
    expect(process).toHaveBeenCalledTimes(1);
    expect(callReliableInbox).toHaveBeenNthCalledWith(
      2,
      "complete_reliable_inbox_event",
      ["event-1", JSON.stringify({ defined: true, value: { status: "updated" } })],
    );
  });

  it("returns the original result without replaying the domain mutation", async () => {
    const payloadHash = createHash("sha256")
      .update(JSON.stringify("fixed")).digest("hex");
    const transaction = {
      callReliableInbox: vi.fn().mockResolvedValue([{
        event_id: "event-1",
        inserted: false,
      }]),
      queryRead: vi.fn().mockResolvedValue([{
        session_id: "call-1",
        event_type: "livekit.participant_joined",
        payload_hash: payloadHash,
        result_payload: { defined: true, value: { status: "connected" } },
        processed_at: new Date(),
      }]),
    };
    const process = vi.fn();
    const input = eventInput({ payload: "fixed" });

    const result = await new PostgresReliableInboxRepository().process(
      transaction as never,
      input,
      process,
    );

    expect(result).toEqual({ duplicate: true, result: { status: "connected" } });
    expect(process).not.toHaveBeenCalled();
  });

  it("rejects an event id reused with a changed payload", async () => {
    const transaction = {
      callReliableInbox: vi.fn().mockResolvedValue([{
        event_id: "event-1",
        inserted: false,
      }]),
      queryRead: vi.fn().mockResolvedValue([{
        session_id: "call-1",
        event_type: "livekit.participant_joined",
        payload_hash: "0".repeat(64),
        result_payload: { defined: true, value: { status: "connected" } },
        processed_at: new Date(),
      }]),
    };

    await expect(new PostgresReliableInboxRepository().process(
      transaction as never,
      eventInput(),
      vi.fn(),
    )).rejects.toBeInstanceOf(PostgresInboxPayloadConflictError);
  });
});

function eventInput(overrides: Partial<{
  eventId: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
}> = {}) {
  return {
    eventId: "event-1",
    sessionId: "call-1",
    eventType: "livekit.participant_joined",
    payload: { participant: "operator" },
    ...overrides,
  };
}
