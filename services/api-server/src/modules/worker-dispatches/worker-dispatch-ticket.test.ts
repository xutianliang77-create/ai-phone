import { describe, expect, it } from "vitest";
import {
  issueWorkerDispatchTicket,
  verifyWorkerDispatchTicket,
  workerDispatchTicketNonce,
} from "./worker-dispatch-ticket.js";

describe("worker dispatch ticket", () => {
  it("reissues the same signed ticket for one persisted generation", () => {
    const secret = "ticket-secret-that-is-at-least-32-bytes";
    const now = new Date("2026-07-17T10:00:00.000Z");
    const nonce = workerDispatchTicketNonce({
      sessionId: "session_1",
      generation: 2,
      secret,
    });
    const input = {
      callId: "call_1",
      sessionId: "session_1",
      roomName: "room_1",
      agentName: "translation-runtime",
      generation: 2,
      secret,
      ttlSeconds: 600,
      nonce,
      now,
    };

    const first = issueWorkerDispatchTicket(input);
    const second = issueWorkerDispatchTicket(input);
    expect(second).toBe(first);
    expect(verifyWorkerDispatchTicket(
      first,
      secret,
      new Date("2026-07-17T10:05:00.000Z"),
    )).toMatchObject({ generation: 2, nonce });
    expect(workerDispatchTicketNonce({
      sessionId: "session_1",
      generation: 3,
      secret,
    })).not.toBe(nonce);
  });
});
