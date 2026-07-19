import { describe, expect, it } from "vitest";
import { isReliableCommunicationEvent } from "./envelopes.js";
import { requireCommunicationId } from "./identifiers.js";

describe("communication contracts", () => {
  it("accepts bounded opaque identifiers", () => {
    expect(requireCommunicationId("sessionId", " session-1 ")).toBe("session-1");
  });

  it("rejects missing and oversized identifiers", () => {
    expect(() => requireCommunicationId("sessionId", "")).toThrow();
    expect(() => requireCommunicationId("legId", "x".repeat(161))).toThrow();
  });

  it("separates discardable realtime signals from reliable events", () => {
    expect(isReliableCommunicationEvent("speech.transcript.partial")).toBe(false);
    expect(isReliableCommunicationEvent("speech.transcript.final")).toBe(true);
    expect(isReliableCommunicationEvent("billing.hold.settled")).toBe(true);
  });
});
