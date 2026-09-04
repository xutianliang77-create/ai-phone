import { describe, expect, it } from "vitest";
import { parseClientPlaybackReceipt } from
  "./client-playback-receipts.js";

describe("client playback receipts", () => {
  const receipt = {
    version: 1,
    receiptId: "receipt-1",
    type: "client.playback.ended",
    sessionId: "session-1",
    legId: "leg-host",
    turnId: "turn-7",
    workId: "work-1",
    deliveryAttemptId: "delivery-1",
    playbackId: "playback-1",
    clientInstanceId: "client-ios-1",
    clientParticipantIdentity: "session-1:host:user-1",
    workerParticipantIdentity: "session-1:worker:voice_agent_001_g4",
    ownershipLeaseId: "voice-lease-1",
    ownershipGeneration: 6,
    turnGeneration: 4,
    dispatchGeneration: 4,
    playbackGeneration: 11,
    occurredAt: "2026-07-30T08:01:03.250Z",
  };

  it("accepts an exact target client playback-ended receipt", () => {
    expect(parseClientPlaybackReceipt(receipt)).toEqual(receipt);
  });

  it("requires failure receipts to carry a bounded failure code", () => {
    expect(() => parseClientPlaybackReceipt({
      ...receipt,
      type: "client.playback.failed",
    })).toThrow("requires failureCode");
    expect(parseClientPlaybackReceipt({
      ...receipt,
      type: "client.playback.failed",
      failureCode: "audio_output_unavailable",
    })).toMatchObject({ failureCode: "audio_output_unavailable" });
  });

  it("rejects missing scoped generation and breaking versions", () => {
    expect(() => parseClientPlaybackReceipt({
      ...receipt,
      playbackGeneration: 0,
    })).toThrow("playbackGeneration");
    expect(() => parseClientPlaybackReceipt({
      ...receipt,
      version: 2,
    })).toThrow("version");
    expect(() => parseClientPlaybackReceipt({
      ...receipt,
      workerParticipantIdentity: "",
    })).toThrow("workerParticipantIdentity");
  });
});
